(function () {
  "use strict";

  const DATA = window.GIS_DATA;
  if (!DATA) {
    document.body.innerHTML =
      "<div style='padding:40px;font-family:sans-serif'><h2>数据加载失败</h2><p>未找到 data/gis_data.js 中的 GIS_DATA。</p></div>";
    return;
  }

  const STORAGE_KEY = "gis_review_state_v1";

  const chapterMap = {};
  const cardMap = {};
  const allCards = [];
  DATA.chapters.forEach((ch) => {
    chapterMap[ch.id] = ch;
    ch.cards.forEach((card) => {
      card._chapterNum = ch.num;
      card._chapterTitle = ch.title;
      cardMap[card.id] = card;
      allCards.push(card);
    });
  });

  function loadPersistedState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          mastery: parsed.mastery && typeof parsed.mastery === "object" ? parsed.mastery : {},
          notes: parsed.notes && typeof parsed.notes === "object" ? parsed.notes : {},
          theme: parsed.theme === "dark" ? "dark" : "light",
        };
      }
    } catch (e) {
      // ignore storage error
    }
    return { mastery: {}, notes: {}, theme: "light" };
  }

  const persisted = loadPersistedState();

  function savePersistedState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    } catch (e) {
      // ignore storage quota / privacy error
    }
  }

  const state = {
    activeView: "chapters",
    activeChapterId: DATA.chapters[0].id,
    statusFilter: "all",
    clozeMode: false,
    outlineMode: false,
    showAllPages: false,
    openPageCards: new Set(),
    expandedInOutline: new Set(),
    fwTab: "all",
    kgSelectedId: DATA.knowledgeGraph.nodes[0].id,
    fcScope: "all",
    fcQueue: [],
    fcIndex: 0,
    fcFlipped: false,
    fcStats: { reviewed: 0, forgot: 0, fuzzy: 0, good: 0 },
    modalMode: null,
    modalBookPage: null,
    modalZoom: 100,
  };

  // ==================== 工具函数 ====================
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function pad3(n) {
    return String(n).padStart(3, "0");
  }

  function getMastery(cardId) {
    return persisted.mastery[cardId] || "unlearned";
  }

  function setMastery(cardId, val) {
    if (val === "unlearned") {
      delete persisted.mastery[cardId];
    } else {
      persisted.mastery[cardId] = val;
    }
    savePersistedState();
    updateGlobalMasteryUI();
    renderSidebar();
  }

  function getNote(cardId) {
    return persisted.notes[cardId] || "";
  }

  function setNote(cardId, txt) {
    const clean = txt.trim();
    if (!clean) {
      delete persisted.notes[cardId];
    } else {
      persisted.notes[cardId] = txt;
    }
    savePersistedState();
  }

  function renderClozeHtml(clozeText) {
    const parts = [];
    const regex = /\{\{cloze::(.*?)\}\}/g;
    let lastIdx = 0;
    let match;
    while ((match = regex.exec(clozeText)) !== null) {
      if (match.index > lastIdx) {
        parts.push(escapeHtml(clozeText.slice(lastIdx, match.index)));
      }
      const inner = escapeHtml(match[1]);
      if (state.clozeMode) {
        parts.push(
          `<span class="cloze-blank" role="button" tabindex="0" title="点击揭晓/再隐藏">${inner}</span>`
        );
      } else {
        parts.push(`<span class="cloze-normal-hl">${inner}</span>`);
      }
      lastIdx = regex.lastIndex;
    }
    if (lastIdx < clozeText.length) {
      parts.push(escapeHtml(clozeText.slice(lastIdx)));
    }
    return parts.join("");
  }

  function applyTheme(theme) {
    persisted.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    const btn = document.getElementById("btn-theme-toggle");
    if (btn) {
      btn.textContent = theme === "dark" ? "☀️" : "🌙";
      btn.title = theme === "dark" ? "切换浅色护眼主题" : "切换夜间护眼主题";
    }
    savePersistedState();
  }

  function updateGlobalMasteryUI() {
    const masteredCount = allCards.filter((c) => getMastery(c.id) === "mastered").length;
    const total = allCards.length;
    const pct = total ? Math.round((masteredCount / total) * 100) : 0;
    const el = document.getElementById("global-mastery-text");
    if (el) {
      el.innerHTML = `<span class="mastery-prefix">已掌握 </span>${masteredCount}/${total}<span class="mastery-pct"> (${pct}%)</span>`;
    }
  }

  function cardMatchesFilter(card) {
    const m = getMastery(card.id);
    if (state.statusFilter === "core") return card.importance === 3;
    if (state.statusFilter === "todo") return m !== "mastered";
    if (state.statusFilter === "mastered") return m === "mastered";
    return true;
  }

  // ==================== 跨设备同步口令编解码 ====================
  function encodeSyncCode() {
    const payload = JSON.stringify({
      v: 1,
      m: persisted.mastery,
      n: persisted.notes,
    });
    const bytes = new TextEncoder().encode(payload);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 1) {
      bin += String.fromCharCode(bytes[i]);
    }
    return "GIS1:" + btoa(bin);
  }

  function decodeSyncCode(code) {
    const raw = (code || "").trim();
    if (!raw.startsWith("GIS1:")) {
      throw new Error("口令格式必须以 GIS1: 开头");
    }
    const bin = atob(raw.slice(5).trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      bytes[i] = bin.charCodeAt(i);
    }
    const jsonStr = new TextDecoder().decode(bytes);
    const obj = JSON.parse(jsonStr);
    if (!obj || typeof obj !== "object") {
      throw new Error("无效的同步数据");
    }
    return {
      mastery: obj.m && typeof obj.m === "object" ? obj.m : {},
      notes: obj.n && typeof obj.n === "object" ? obj.n : {},
    };
  }

  // ==================== 双端模式按钮同步 ====================
  function syncModeToggleUI() {
    const dCloze = document.getElementById("btn-cloze-mode");
    const mCloze = document.getElementById("m-btn-cloze");
    [dCloze, mCloze].forEach((b) => {
      if (!b) return;
      b.classList.toggle("active", state.clozeMode);
      b.setAttribute("aria-pressed", String(state.clozeMode));
    });

    const dOut = document.getElementById("btn-outline-mode");
    const mOut = document.getElementById("m-btn-outline");
    [dOut, mOut].forEach((b) => {
      if (!b) return;
      b.classList.toggle("active", state.outlineMode);
      b.setAttribute("aria-pressed", String(state.outlineMode));
    });

    const dPages = document.getElementById("btn-all-pages");
    const mPages = document.getElementById("m-btn-pages");
    [dPages, mPages].forEach((b) => {
      if (!b) return;
      b.classList.toggle("active-primary", state.showAllPages);
      b.setAttribute("aria-pressed", String(state.showAllPages));
    });
  }

  function toggleClozeMode() {
    state.clozeMode = !state.clozeMode;
    syncModeToggleUI();
    if (state.activeView === "chapters") renderChapterView();
  }

  function toggleOutlineMode() {
    state.outlineMode = !state.outlineMode;
    state.expandedInOutline.clear();
    syncModeToggleUI();
    if (state.activeView === "chapters") renderChapterView();
  }

  function toggleAllPagesMode() {
    state.showAllPages = !state.showAllPages;
    if (!state.showAllPages) state.openPageCards.clear();
    syncModeToggleUI();
    if (state.activeView === "chapters") renderChapterView();
  }

  // ==================== 视图切换与跨卡跳转 ====================
  function switchView(viewName, skipScrollTop) {
    state.activeView = viewName;
    document.querySelectorAll(".nav-tab, .bottom-nav-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === viewName);
    });
    document.querySelectorAll(".view-panel").forEach((sec) => {
      sec.classList.toggle("active", sec.id === `view-${viewName}`);
    });
    const sidebar = document.getElementById("sidebar");
    if (sidebar) {
      sidebar.classList.toggle("collapsed-view", viewName !== "chapters");
    }
    const quickbar = document.getElementById("mobile-quickbar");
    if (quickbar) {
      quickbar.classList.toggle("visible", viewName === "chapters");
    }
    closeMobileSidebar();

    if (viewName === "chapters") renderChapterView();
    else if (viewName === "framework") renderFrameworkView();
    else if (viewName === "flashcards") renderFlashcardView();
    else if (viewName === "comparisons") renderComparisonsView();
    else if (viewName === "graph") renderGraphView();

    if (!skipScrollTop) {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  }

  function jumpToCard(cardId) {
    const card = cardMap[cardId];
    if (!card) return;
    if (state.statusFilter !== "all" && !cardMatchesFilter(card)) {
      state.statusFilter = "all";
      document.querySelectorAll("#status-filter-pills .filter-pill").forEach((b) => {
        b.classList.toggle("active", b.dataset.filter === "all");
      });
    }
    state.activeChapterId = card.chapterId;
    if (state.outlineMode) {
      state.expandedInOutline.add(cardId);
    }
    switchView("chapters", true);
    renderSidebar();

    window.requestAnimationFrame(() => {
      const el = document.getElementById(`card-${cardId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.remove("card-pulse");
        void el.offsetWidth;
        el.classList.add("card-pulse");
        window.setTimeout(() => el.classList.remove("card-pulse"), 1900);
      }
    });
  }

  // ==================== 左侧目录渲染 ====================
  function renderSidebar() {
    const listEl = document.getElementById("chapter-list");
    if (!listEl) return;
    const html = DATA.chapters
      .map((ch) => {
        const total = ch.cards.length;
        const filtered = ch.cards.filter(cardMatchesFilter).length;
        const mastered = ch.cards.filter((c) => getMastery(c.id) === "mastered").length;
        const pct = total ? Math.round((mastered / total) * 100) : 0;
        const isActive = ch.id === state.activeChapterId;
        return `
          <button class="ch-nav-btn ${isActive ? "active" : ""}" data-ch="${escapeHtml(ch.id)}">
            <div class="ch-nav-row">
              <span class="ch-nav-name">${escapeHtml(ch.title)}</span>
              <span class="ch-nav-count">${filtered}/${total}</span>
            </div>
            <div class="ch-mini-bar" title="掌握度 ${pct}%">
              <div class="ch-mini-fill" style="width:${pct}%"></div>
            </div>
          </button>
        `;
      })
      .join("");
    listEl.innerHTML = html;

    const footEl = document.getElementById("sidebar-footer");
    if (footEl && DATA.meta.skippedBookChapters) {
      const notes = DATA.meta.skippedBookChapters
        .map((s) => `第${s.num}章(${s.pages})`)
        .join("、");
      footEl.innerHTML = `💡 <b>说明</b>：${escapeHtml(notes)} 在划线照片与手写框架中未划考，重点内容已按全书顺序合并至 <b>${DATA.meta.totalCards}</b> 张规范卡片。`;
    }
  }

  // ==================== 视图 1：章节精讲 ====================
  function renderCardHtml(card) {
    const m = getMastery(card.id);
    const isPagesOpen = state.showAllPages || state.openPageCards.has(card.id);
    const isCollapsed = state.outlineMode && !state.expandedInOutline.has(card.id);
    const stars = "★".repeat(card.importance);
    const impLabel =
      card.importance === 3 ? `${stars} 核心必背` : card.importance === 2 ? `${stars} 重要考点` : `${stars} 理解掌握`;
    const primaryPgs = card.pages.primary || [];
    const secPgs = card.pages.secondary || [];

    const pointsHtml = card.points
      .map(
        (pt) => `
        <li class="point-item">
          <span class="point-heading">${escapeHtml(pt.heading)}：</span>
          <span>${renderClozeHtml(pt.clozeText)}</span>
        </li>
      `
      )
      .join("");

    const formulasHtml = (card.formulas || [])
      .map((f) => `<div class="formula-block">${escapeHtml(f)}</div>`)
      .join("");

    let tableHtml = "";
    if (card.table && card.table.headers && card.table.headers.length) {
      const ths = card.table.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
      const trs = card.table.rows
        .map((r) => `<tr>${r.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
        .join("");
      tableHtml = `<div class="table-wrap"><table class="data-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
    }

    let workedHtml = "";
    if (card.workedExample && card.workedExample.steps && card.workedExample.steps.length) {
      const we = card.workedExample;
      const stepsHtml = we.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("");
      const matricesHtml = (we.tables || [])
        .map((mt) => {
          const mths = mt.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
          const mtrs = mt.rows
            .map((r) => `<tr>${r.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
            .join("");
          return `
            <div class="matrix-card">
              <div class="matrix-card-title">${escapeHtml(mt.title)}</div>
              <table class="matrix-table"><thead><tr>${mths}</tr></thead><tbody>${mtrs}</tbody></table>
            </div>
          `;
        })
        .join("");
      workedHtml = `
        <div class="worked-box">
          <div class="worked-title">📝 ${escapeHtml(we.title)}</div>
          <ol class="worked-steps">${stepsHtml}</ol>
          ${matricesHtml ? `<div class="matrix-grid">${matricesHtml}</div>` : ""}
        </div>
      `;
    }

    let figsHtml = "";
    if (card.figures && card.figures.length) {
      figsHtml = `
        <div class="figures-grid">
          ${card.figures
            .map(
              (fg) => `
              <figure class="fig-card">
                <img src="${escapeHtml(fg.src)}" alt="${escapeHtml(fg.caption)}" loading="lazy" data-fig-src="${escapeHtml(fg.src)}" data-fig-cap="${escapeHtml(fg.caption)}" />
                <figcaption>${escapeHtml(fg.caption)}（点击放大）</figcaption>
              </figure>
            `
            )
            .join("")}
        </div>
      `;
    }

    const primaryChips = primaryPgs
      .map(
        (pg) =>
          `<button class="page-chip" data-open-page="${pg}" title="点击预览教材第 ${pg} 页高清扫描图">P.${pg} 🔍</button>`
      )
      .join("");
    const secChips = secPgs
      .map(
        (s) =>
          `<button class="page-chip page-chip-sec" data-open-page="${s.page}" title="点击预览第 ${s.page} 页">P.${s.page} · ${escapeHtml(s.note)}</button>`
      )
      .join("");

    const relTypeLabel = {
      prereq: "前置",
      next: "延伸",
      compare: "对比",
      application: "应用",
    };

    const relLinksHtml = (card.relatedCards || [])
      .map(
        (rc) =>
          `<button class="rel-chip rel-type-${escapeHtml(rc.type)}" data-jump="${escapeHtml(rc.targetId)}">[${relTypeLabel[rc.type] || "关联"}] ${escapeHtml(rc.label)} →</button>`
      )
      .join("");

    const noteVal = getNote(card.id);

    return `
      <article id="card-${escapeHtml(card.id)}" class="k-card mastery-${m} ${isPagesOpen ? "pages-open" : ""} ${isCollapsed ? "outline-collapsed" : ""}" data-card-id="${escapeHtml(card.id)}">
        <div class="k-card-header">
          <div class="k-card-title-area">
            <div class="k-card-badges">
              <span class="badge badge-sec">${escapeHtml(card.sectionCode)} ${escapeHtml(card.sectionTitle)}</span>
              <span class="badge badge-imp-${card.importance}">${impLabel}</span>
              ${card.dedupBadge ? `<span class="badge badge-dedup">✨ ${escapeHtml(card.dedupBadge)}</span>` : ""}
            </div>
            <h3 class="k-card-title">${escapeHtml(card.title)}</h3>
          </div>
          <div class="k-card-actions">
            <button class="btn-page-reveal" data-toggle-page="${escapeHtml(card.id)}" aria-expanded="${isPagesOpen}">
              ${isPagesOpen ? "📖 收起页码" : "📖 页码"}
            </button>
            <div class="mastery-seg" role="group" aria-label="熟练度标记">
              <button class="mastery-btn ${m === "unlearned" ? "active" : ""}" data-set-mastery="${escapeHtml(card.id)}" data-state="unlearned">未背</button>
              <button class="mastery-btn ${m === "fuzzy" ? "active" : ""}" data-set-mastery="${escapeHtml(card.id)}" data-state="fuzzy">模糊</button>
              <button class="mastery-btn ${m === "mastered" ? "active" : ""}" data-set-mastery="${escapeHtml(card.id)}" data-state="mastered">牢记</button>
            </div>
          </div>
        </div>

        <div class="card-pages-drawer">
          <div class="pages-drawer-row">
            <span class="pages-label">📌 主讲教材页码（点击看原书页）：</span>
            ${primaryChips || '<span class="muted-text">见下方关联页</span>'}
          </div>
          ${
            secChips
              ? `<div class="pages-drawer-row"><span class="pages-label">🔁 全书复现归并处：</span>${secChips}</div>`
              : ""
          }
        </div>

        <div class="card-summary-box">
          <span class="summary-tag">核心定义</span>${escapeHtml(card.summary)}
        </div>

        <div class="outline-expand-bar">
          <button class="btn-sm" data-expand-card="${escapeHtml(card.id)}">展开全部要点与配图 ↓</button>
        </div>

        <div class="card-detail-body">
          ${
            state.clozeMode
              ? `<div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
                   <button class="btn-sm" data-reveal-card-cloze="${escapeHtml(card.id)}">👁 一键显/隐本卡挖空</button>
                 </div>`
              : ""
          }
          <ul class="points-list">${pointsHtml}</ul>
          ${formulasHtml}
          ${tableHtml}
          ${workedHtml}
          ${figsHtml}
          ${card.mnemonic ? `<div class="mnemonic-box">💡 <b>记忆抓手</b>：${escapeHtml(card.mnemonic)}</div>` : ""}
          <div class="note-box">
            <textarea class="note-input" data-note-card="${escapeHtml(card.id)}" placeholder="✎ 在此记录个人背诵易错点或课堂补充（自动保存）..." rows="1">${escapeHtml(noteVal)}</textarea>
          </div>
        </div>

        <div class="k-card-footer">
          <div class="rel-links">${relLinksHtml}</div>
          <button class="btn-sm" data-quiz-card="${escapeHtml(card.id)}">🃏 自测这题</button>
        </div>
      </article>
    `;
  }

  function renderChapterView() {
    const container = document.getElementById("view-chapters");
    if (!container) return;
    const chIdx = DATA.chapters.findIndex((c) => c.id === state.activeChapterId);
    const ch = DATA.chapters[chIdx >= 0 ? chIdx : 0];
    const prevCh = chIdx > 0 ? DATA.chapters[chIdx - 1] : null;
    const nextCh = chIdx < DATA.chapters.length - 1 ? DATA.chapters[chIdx + 1] : null;

    const filteredCards = ch.cards.filter(cardMatchesFilter);
    const ov = ch.chapterOverview;

    const cardsHtml = filteredCards.length
      ? filteredCards.map(renderCardHtml).join("")
      : `<div class="k-card" style="text-align:center;padding:36px;">
           <p>当前筛选条件下本章暂无卡片。</p>
           <button class="btn-primary" id="btn-reset-filter-inline">显示本章全部卡片</button>
         </div>`;

    let xrefHtml = "";
    if (ch.crossRefs && ch.crossRefs.length) {
      const items = ch.crossRefs
        .map((xr) => {
          const target = cardMap[xr.targetId];
          const pgStr = (xr.pages || []).map((p) => `P.${p}`).join(", ");
          return `
            <div class="xref-item">
              <div class="xref-info">
                <strong>${escapeHtml(xr.sectionCode)} ${escapeHtml(xr.title)}</strong>
                ${pgStr ? `<span class="badge badge-sec" style="margin-left:6px">${escapeHtml(pgStr)}</span>` : ""}
                <div class="muted-text" style="margin:3px 0 0">${escapeHtml(xr.brief)}</div>
              </div>
              <button class="btn-sm" data-jump="${escapeHtml(xr.targetId)}">
                直达详讲：${escapeHtml(target ? target.title : xr.targetId)} →
              </button>
            </div>
          `;
        })
        .join("");
      xrefHtml = `
        <div class="xref-panel">
          <h3>🔗 本章提及但已去重归并至他章详讲的知识点（点击一跳直达）</h3>
          <div class="xref-list">${items}</div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="chapter-hero">
        <div class="chapter-hero-top">
          <div>
            <h1>${escapeHtml(ch.title)}</h1>
            <span class="muted-text">原书第 ${ch.startPage}–${ch.endPage} 页 · 共 ${ch.cards.length} 张规范卡片</span>
          </div>
          <div class="chapter-hero-nav">
            <button class="btn-sm" ${prevCh ? `data-switch-ch="${escapeHtml(prevCh.id)}"` : "disabled"}>← 上一章</button>
            <button class="btn-sm" ${nextCh ? `data-switch-ch="${escapeHtml(nextCh.id)}"` : "disabled"}>下一章 →</button>
          </div>
        </div>
        <div class="overview-grid">
          <div class="overview-box"><div class="overview-label">📍 本章核心定位</div>${escapeHtml(ov.position)}</div>
          <div class="overview-box"><div class="overview-label">⬅️ 承接前章</div>${escapeHtml(ov.prevLink)}</div>
          <div class="overview-box"><div class="overview-label">➡️ 启迪后章</div>${escapeHtml(ov.nextLink)}</div>
          <div class="overview-box"><div class="overview-label">🎯 复习与高频考点</div>${escapeHtml(ov.examFocus)}</div>
        </div>
      </div>

      ${cardsHtml}
      ${xrefHtml}

      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:24px;">
        <button class="btn-secondary" ${prevCh ? `data-switch-ch="${escapeHtml(prevCh.id)}"` : "disabled"}>← ${prevCh ? escapeHtml(prevCh.title) : "已是最前章"}</button>
        <button class="btn-primary" ${nextCh ? `data-switch-ch="${escapeHtml(nextCh.id)}"` : "disabled"}>${nextCh ? `下一章：${escapeHtml(nextCh.title)} →` : "已是最后一章 🎉"}</button>
      </div>
    `;
  }

  // ==================== 视图 2：手写框架联动 ====================
  function renderFrameworkView() {
    const container = document.getElementById("view-framework");
    if (!container) return;
    const fwPages = DATA.handwrittenFramework.pages;
    const shownPages = state.fwTab === "all" ? fwPages : fwPages.filter((p) => String(p.pageNum) === String(state.fwTab));

    const tabsHtml = `
      <div class="fw-toolbar">
        <div>
          <h2 style="margin:0 0 2px;font-size:20px;">🧭 手写 3 页整理框架 ↔ 精讲卡片双向联动</h2>
          <div class="muted-text" style="margin:0">按您的三页手写整理框架 1:1 映射全书规范卡片，点击蓝色胶囊直达精讲卡片背诵。</div>
        </div>
        <div class="fw-tabs">
          <button class="fw-tab ${state.fwTab === "all" ? "active" : ""}" data-fw-tab="all">全景三页</button>
          ${fwPages
            .map(
              (p) =>
                `<button class="fw-tab ${String(state.fwTab) === String(p.pageNum) ? "active" : ""}" data-fw-tab="${p.pageNum}">第 ${p.pageNum} 页</button>`
            )
            .join("")}
        </div>
      </div>
    `;

    const bodyHtml = shownPages
      .map((pg) => {
        const nodesHtml = pg.nodes
          .map((nd) => {
            const nodeCids = nd.cardIds || [];
            const mastered = nodeCids.filter((id) => getMastery(id) === "mastered").length;
            const pct = nodeCids.length ? Math.round((mastered / nodeCids.length) * 100) : 0;

            const childrenHtml = (nd.children || [])
              .map((ch) => {
                const links = (ch.cardIds || [])
                  .map((cid) => {
                    const card = cardMap[cid];
                    if (!card) return "";
                    const cm = getMastery(cid);
                    const icon = cm === "mastered" ? "✅" : cm === "fuzzy" ? "🟠" : "📄";
                    return `<button class="page-chip" data-jump="${escapeHtml(cid)}" title="跳转精讲卡片">${icon} ${escapeHtml(card.title)}</button>`;
                  })
                  .join("");
                return `
                  <div class="fw-child-item">
                    <div class="fw-child-text">
                      <div class="fw-child-label">${escapeHtml(ch.label)}</div>
                      <div class="fw-child-raw">${escapeHtml(ch.rawText)}</div>
                    </div>
                    <div class="fw-child-links">${links}</div>
                  </div>
                `;
              })
              .join("");

            return `
              <div class="fw-chapter-block">
                <div class="fw-chapter-head">
                  <strong style="font-size:15.5px;color:var(--text-main)">${escapeHtml(nd.label)}</strong>
                  <span class="badge ${pct === 100 ? "badge-imp-3" : "badge-sec"}">掌握 ${mastered}/${nodeCids.length} (${pct}%)</span>
                </div>
                <div class="fw-child-list">${childrenHtml}</div>
              </div>
            `;
          })
          .join("");

        return `
          <div class="fw-page-card">
            <div class="fw-page-header">
              <h3 style="margin:0;color:var(--primary)">${escapeHtml(pg.title)}</h3>
              <span class="muted-text">手写原稿：${escapeHtml(pg.photoId)}</span>
            </div>
            ${nodesHtml}
          </div>
        `;
      })
      .join("");

    container.innerHTML = tabsHtml + bodyHtml;
  }

  // ==================== 视图 3：闪卡抽背 ====================
  function buildFlashcardQueue(shuffle) {
    let pool = [];
    if (state.fcScope === "all") pool = [...allCards];
    else if (state.fcScope === "todo") pool = allCards.filter((c) => getMastery(c.id) !== "mastered");
    else if (state.fcScope === "core") pool = allCards.filter((c) => c.importance === 3);
    else if (chapterMap[state.fcScope]) pool = [...chapterMap[state.fcScope].cards];
    else pool = [...allCards];

    if (shuffle) {
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
    }
    state.fcQueue = pool.map((c) => c.id);
    state.fcIndex = 0;
    state.fcFlipped = false;
    state.fcStats = { reviewed: 0, forgot: 0, fuzzy: 0, good: 0 };
  }

  function startSingleFlashcard(cardId) {
    state.fcScope = "all";
    state.fcQueue = [cardId];
    state.fcIndex = 0;
    state.fcFlipped = false;
    state.fcStats = { reviewed: 0, forgot: 0, fuzzy: 0, good: 0 };
    switchView("flashcards");
  }

  function renderFlashcardView() {
    const container = document.getElementById("view-flashcards");
    if (!container) return;
    if (!state.fcQueue.length && state.fcStats.reviewed === 0) {
      buildFlashcardQueue(false);
    }

    const chOptions = DATA.chapters
      .map(
        (ch) =>
          `<option value="${escapeHtml(ch.id)}" ${state.fcScope === ch.id ? "selected" : ""}>${escapeHtml(ch.title)} (${ch.cards.length}张)</option>`
      )
      .join("");

    const controlsHtml = `
      <div class="fc-controls">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <strong>抽背范围：</strong>
          <select id="fc-scope-select" class="fc-select">
            <option value="all" ${state.fcScope === "all" ? "selected" : ""}>全书全部 (${allCards.length}张)</option>
            <option value="todo" ${state.fcScope === "todo" ? "selected" : ""}>待巩固（未背+模糊）</option>
            <option value="core" ${state.fcScope === "core" ? "selected" : ""}>仅 ★★★ 核心必背</option>
            ${chOptions}
          </select>
          <button id="fc-btn-order" class="btn-sm">顺序重抽</button>
          <button id="fc-btn-shuffle" class="btn-sm">🔀 洗牌乱序</button>
        </div>
        <div class="muted-text" style="margin:0">
          进度：<b>${Math.min(state.fcIndex, state.fcQueue.length)} / ${state.fcQueue.length}</b> ·
          牢记 ${state.fcStats.good} · 模糊 ${state.fcStats.fuzzy} · 忘了重抽 ${state.fcStats.forgot}
        </div>
      </div>
    `;

    if (state.fcQueue.length === 0) {
      container.innerHTML =
        controlsHtml +
        `<div class="k-card" style="text-align:center;padding:42px;">
           <h2>🎉 当前范围内没有待抽背的卡片！</h2>
           <p class="muted-text">您可以切换到“全书全部”巩固复习，或回到章节精讲查看其他内容。</p>
           <button class="btn-primary" id="fc-reset-all-btn">抽取全书全部卡片</button>
         </div>`;
      return;
    }

    if (state.fcIndex >= state.fcQueue.length) {
      container.innerHTML =
        controlsHtml +
        `<div class="k-card" style="text-align:center;padding:42px;">
           <h2>🏆 本轮 ${state.fcQueue.length} 张闪卡已全部完成！</h2>
           <p class="muted-text">本轮已标记：牢记 ${state.fcStats.good} 次 · 模糊 ${state.fcStats.fuzzy} 次 · 忘了重抽 ${state.fcStats.forgot} 次。</p>
           <div class="btn-row" style="justify-content:center;margin-top:16px">
             <button class="btn-primary" id="fc-btn-again-shuffle">🔀 再来一轮乱序</button>
             <button class="btn-secondary" id="fc-btn-only-todo">仅抽待巩固卡片</button>
           </div>
         </div>`;
      return;
    }

    const cid = state.fcQueue[state.fcIndex];
    const card = cardMap[cid];
    const fc = card.flashcard;

    container.innerHTML = `
      ${controlsHtml}
      <div class="fc-stage">
        <div id="fc-card-3d" class="fc-card-3d ${state.fcFlipped ? "flipped" : ""}" role="button" tabindex="0" aria-label="点击翻转闪卡">
          <div class="fc-face fc-front">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
              <span class="badge badge-sec">${escapeHtml(card._chapterTitle)} · ${escapeHtml(card.sectionCode)}</span>
              <span class="muted-text">第 ${state.fcIndex + 1} / ${state.fcQueue.length} 张</span>
            </div>
            <div class="fc-question">${escapeHtml(fc.q)}</div>
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
              <span class="muted-text">💡 提示：${escapeHtml(fc.hint)}</span>
              <span class="badge badge-imp-${card.importance}">点击卡片翻面 ↻</span>
            </div>
          </div>
          <div class="fc-face fc-back">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">
              <strong style="color:var(--primary)">${escapeHtml(card.title)}</strong>
              <button class="btn-sm" id="fc-btn-go-card" data-jump="${escapeHtml(card.id)}">查看完整精讲 →</button>
            </div>
            <div class="fc-answer">${escapeHtml(fc.a)}</div>
            ${card.mnemonic ? `<div class="mnemonic-box" style="margin-top:14px">💡 <b>记忆抓手</b>：${escapeHtml(card.mnemonic)}</div>` : ""}
          </div>
        </div>
      </div>

      <div class="fc-actions-bar">
        <button class="btn-secondary" id="fc-btn-flip" style="flex:1 1 100%;max-width:340px;justify-content:center;">↻ 翻转看答案</button>
        <button class="fc-rate-btn fc-rate-forgot" data-fc-rate="forgot">😕 忘了重抽</button>
        <button class="fc-rate-btn fc-rate-fuzzy" data-fc-rate="fuzzy">🤔 有点模糊</button>
        <button class="fc-rate-btn fc-rate-good" data-fc-rate="good">✅ 牢记了</button>
      </div>
    `;
  }

  function rateFlashcard(rating) {
    if (state.fcIndex >= state.fcQueue.length) return;
    const cid = state.fcQueue[state.fcIndex];
    state.fcStats.reviewed += 1;
    if (rating === "forgot") {
      state.fcStats.forgot += 1;
      setMastery(cid, "fuzzy");
      const insertAt = Math.min(state.fcIndex + 4, state.fcQueue.length);
      state.fcQueue.splice(insertAt, 0, cid);
    } else if (rating === "fuzzy") {
      state.fcStats.fuzzy += 1;
      setMastery(cid, "fuzzy");
    } else if (rating === "good") {
      state.fcStats.good += 1;
      setMastery(cid, "mastered");
    }
    state.fcIndex += 1;
    state.fcFlipped = false;
    renderFlashcardView();
  }

  // ==================== 视图 4：易混对比与去重总表 ====================
  function renderComparisonsView() {
    const container = document.getElementById("view-comparisons");
    if (!container) return;

    const cmpHtml = DATA.comparisons
      .map((cmp) => {
        const links = cmp.relatedCardIds
          .map((cid) => {
            const c = cardMap[cid];
            return c ? `<button class="page-chip" data-jump="${escapeHtml(cid)}">📌 ${escapeHtml(c.title)}</button>` : "";
          })
          .join("");
        const ths = cmp.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
        const trs = cmp.rows
          .map((r) => `<tr>${r.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
          .join("");
        return `
          <div class="cmp-card">
            <div class="cmp-card-head">
              <div>
                <h3>${escapeHtml(cmp.title)}</h3>
                <div class="muted-text" style="margin:0">${escapeHtml(cmp.subtitle)}</div>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap">${links}</div>
            </div>
            <div class="table-wrap">
              <table class="data-table"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>
            </div>
          </div>
        `;
      })
      .join("");

    const dedupRows = DATA.dedupIndex
      .map((dd) => {
        const target = cardMap[dd.canonicalId];
        const pChips = dd.primaryPages
          .map((p) => `<button class="page-chip" data-open-page="${p}">P.${p}</button>`)
          .join(" ");
        const mChips = dd.mergedPages
          .map((p) => `<button class="page-chip page-chip-sec" data-open-page="${p}">P.${p}</button>`)
          .join(" ");
        return `
          <tr>
            <td><strong>${escapeHtml(dd.concept)}</strong></td>
            <td><button class="page-chip" data-jump="${escapeHtml(dd.canonicalId)}">${escapeHtml(target ? target.title : dd.canonicalId)} →</button></td>
            <td>${pChips}</td>
            <td>${mChips}</td>
            <td>${escapeHtml(dd.note)}</td>
          </tr>
        `;
      })
      .join("");

    container.innerHTML = `
      <div style="margin-bottom:18px;">
        <h2 style="margin:0 0 4px;font-size:20px;">⚖️ 全书高频易混概念对比矩阵 & 重复知识点归并总表</h2>
        <div class="muted-text" style="margin:0">专治“概念混在一起记不住”和“前后章节来回重复”，点击蓝色胶囊直接跳转精讲卡片或原书页。</div>
      </div>

      ${cmpHtml}

      <div class="cmp-card">
        <div class="cmp-card-head">
          <div>
            <h3>✨ 全书 14 组重复知识点一次性归并总表</h3>
            <div class="muted-text" style="margin:0">展示全书同一概念分散在各章与术语表中的原始页码，已全部收拢至唯一主阵地卡片。</div>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>知识点</th>
                <th>规范主阵地卡片（点击直达）</th>
                <th>主讲页码</th>
                <th>已归并复现页码</th>
                <th>归并说明</th>
              </tr>
            </thead>
            <tbody>${dedupRows}</tbody>
          </table>
        </div>
      </div>
    `;
  }

  // ==================== 视图 5：原生离线 SVG 知识脉络图 ====================
  const KG_COLORS = {
    "模型基础": { fill: "#e6f2f4", stroke: "#0f5c6e", text: "#0a4654" },
    "矢量模型": { fill: "#eff6ff", stroke: "#1d4ed8", text: "#1e3a8a" },
    "栅格模型": { fill: "#f0fdf4", stroke: "#15803d", text: "#14532d" },
    "处理与管理": { fill: "#fefce8", stroke: "#ca8a04", text: "#713f12" },
    "空间分析": { fill: "#fff7ed", stroke: "#d97706", text: "#7c2d12" },
    "地形水文": { fill: "#fdf2f8", stroke: "#be185d", text: "#831843" },
    "高级建模": { fill: "#f5f3ff", stroke: "#6d28d9", text: "#4c1d95" },
  };

  function renderGraphView() {
    const container = document.getElementById("view-graph");
    if (!container) return;

    const nodes = DATA.knowledgeGraph.nodes;
    const edges = DATA.knowledgeGraph.edges;
    const colTitles = ["Ⅰ 数据模型基石", "Ⅱ 编码管理与探查", "Ⅲ 空间分析与水文", "Ⅳ 插值路径与建模"];
    const nodeW = 196;
    const nodeH = 48;
    const colX = [36, 316, 596, 876];
    const rowY = (r) => 68 + r * 78;

    const posMap = {};
    nodes.forEach((n) => {
      const x = colX[n.col];
      const y = rowY(n.row);
      posMap[n.id] = { x, y, cx: x + nodeW / 2, cy: y + nodeH / 2 };
    });

    const selectedId = state.kgSelectedId;
    const neighborIds = new Set([selectedId]);
    edges.forEach((e) => {
      if (e.from === selectedId) neighborIds.add(e.to);
      if (e.to === selectedId) neighborIds.add(e.from);
    });

    const colHeadersSvg = colTitles
      .map(
        (t, i) => `
        <rect x="${colX[i]}" y="14" width="${nodeW}" height="32" rx="8" fill="var(--bg-subtle)" stroke="var(--border-color)"></rect>
        <text x="${colX[i] + nodeW / 2}" y="35" text-anchor="middle" font-size="13" font-weight="700" fill="var(--primary)">${escapeHtml(t)}</text>
      `
      )
      .join("");

    const edgesSvg = edges
      .map((e) => {
        const p1 = posMap[e.from];
        const p2 = posMap[e.to];
        if (!p1 || !p2) return "";
        const isHi = e.from === selectedId || e.to === selectedId;
        const cls = isHi ? "kg-edge highlighted" : "kg-edge dimmed";
        let pathD;
        if (p1.x === p2.x) {
          const sx = p1.x + nodeW;
          const sy = p1.cy;
          const ex = p2.x + nodeW;
          const ey = p2.cy;
          const ctrlX = sx + 26;
          pathD = `M ${sx} ${sy} C ${ctrlX} ${sy}, ${ctrlX} ${ey}, ${ex} ${ey}`;
        } else {
          const sx = p1.x + nodeW;
          const sy = p1.cy;
          const ex = p2.x;
          const ey = p2.cy;
          const dx = (ex - sx) * 0.48;
          pathD = `M ${sx} ${sy} C ${sx + dx} ${sy}, ${ex - dx} ${ey}, ${ex} ${ey}`;
        }
        return `<path class="${cls}" d="${pathD}" marker-end="${isHi ? "url(#arrow-hi)" : "url(#arrow-dim)"}"><title>${escapeHtml(e.label)}</title></path>`;
      })
      .join("");

    const nodesSvg = nodes
      .map((n) => {
        const p = posMap[n.id];
        const style = KG_COLORS[n.group] || KG_COLORS["模型基础"];
        const isActive = n.id === selectedId;
        const isNeighbor = neighborIds.has(n.id);
        const cls = `kg-node ${isActive ? "active" : isNeighbor ? "" : "dimmed"}`;
        return `
          <g class="${cls}" data-kg-node="${escapeHtml(n.id)}" role="button" tabindex="0">
            <rect x="${p.x}" y="${p.y}" width="${nodeW}" height="${nodeH}" rx="10" fill="${style.fill}" stroke="${style.stroke}" stroke-width="${isActive ? 3 : 1.5}"></rect>
            <text x="${p.x + 12}" y="${p.y + 19}" font-size="11" font-weight="700" fill="${style.stroke}">${escapeHtml(n.chapter)}</text>
            <text x="${p.x + 12}" y="${p.y + 37}" font-size="13" font-weight="700" fill="${style.text}">${escapeHtml(n.label)}</text>
          </g>
        `;
      })
      .join("");

    const selNode = nodes.find((n) => n.id === selectedId) || nodes[0];
    const selCard = cardMap[selNode.id];
    const inLinks = edges
      .filter((e) => e.to === selNode.id)
      .map((e) => {
        const src = nodes.find((n) => n.id === e.from);
        return src
          ? `<button class="rel-chip rel-type-prereq" data-kg-pick="${escapeHtml(src.id)}">⬅ ${escapeHtml(src.label)}（${escapeHtml(e.label)}）</button>`
          : "";
      })
      .join("");
    const outLinks = edges
      .filter((e) => e.from === selNode.id)
      .map((e) => {
        const dst = nodes.find((n) => n.id === e.to);
        return dst
          ? `<button class="rel-chip rel-type-next" data-kg-pick="${escapeHtml(dst.id)}">➡ ${escapeHtml(dst.label)}（${escapeHtml(e.label)}）</button>`
          : "";
      })
      .join("");

    const legendHtml = Object.keys(KG_COLORS)
      .map(
        (g) =>
          `<span><span class="kg-dot" style="background:${KG_COLORS[g].stroke}"></span>${escapeHtml(g)}</span>`
      )
      .join("");

    container.innerHTML = `
      <div style="margin-bottom:14px;">
        <h2 style="margin:0 0 4px;font-size:20px;">🕸️ 全书核心知识点逻辑关联脉络图</h2>
        <div class="muted-text" style="margin:0">单击节点点亮“前置基础”与“后续延伸”连线（左右滑动可看全景）；点击右侧按钮前往精讲卡片。</div>
      </div>

      <div class="kg-layout">
        <div class="kg-canvas-wrap">
          <div class="kg-legend">${legendHtml}</div>
          <svg class="kg-svg" viewBox="0 0 1110 706" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <marker id="arrow-dim" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#9ca3af" />
              </marker>
              <marker id="arrow-hi" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#d97706" />
              </marker>
            </defs>
            ${colHeadersSvg}
            ${edgesSvg}
            ${nodesSvg}
          </svg>
        </div>

        <aside class="kg-detail-panel">
          <span class="badge badge-sec">${escapeHtml(selNode.chapter)} · ${escapeHtml(selNode.group)}</span>
          <h3 style="margin:8px 0 6px;font-size:18px;color:var(--primary)">${escapeHtml(selCard ? selCard.title : selNode.label)}</h3>
          <p style="font-size:13.8px;margin:0 0 12px;color:var(--text-secondary)">${escapeHtml(selCard ? selCard.summary : "")}</p>
          <button class="btn-primary" style="width:100%;margin-bottom:14px;" data-jump="${escapeHtml(selNode.id)}">前往精讲卡片深度背诵 →</button>

          ${
            inLinks
              ? `<div style="margin-bottom:12px;"><div class="overview-label">⬅️ 前置依赖知识点</div><div class="rel-links" style="margin-top:6px">${inLinks}</div></div>`
              : ""
          }
          ${
            outLinks
              ? `<div><div class="overview-label">➡️ 后续延伸应用</div><div class="rel-links" style="margin-top:6px">${outLinks}</div></div>`
              : ""
          }
        </aside>
      </div>
    `;
  }

  // ==================== 原书高清页 / 原理图预览弹窗（含缺失降级） ====================
  function openBookPageModal(pageNum) {
    const avail = DATA.meta.availableBookPages || [];
    state.modalMode = "book_page";
    state.modalBookPage = pageNum;
    state.modalZoom = 100;

    const modal = document.getElementById("page-modal");
    const img = document.getElementById("modal-img");
    const fallback = document.getElementById("modal-img-fallback");
    const title = document.getElementById("modal-title");
    const sub = document.getElementById("modal-subtitle");
    const relBar = document.getElementById("modal-related-bar");
    const prevBtn = document.getElementById("modal-prev-page");
    const nextBtn = document.getElementById("modal-next-page");

    const matchingCards = allCards.filter(
      (c) =>
        (c.pages.primary || []).includes(pageNum) ||
        (c.pages.secondary || []).some((s) => s.page === pageNum)
    );
    const chObj = DATA.chapters.find((ch) => pageNum >= ch.startPage && pageNum <= ch.endPage);

    title.textContent = `📖 原书第 ${pageNum} 页（参考扫描）`;
    sub.textContent = chObj ? `${chObj.title} · 书本印刷页码 P.${pageNum}` : `书本印刷页码 P.${pageNum}`;

    fallback.classList.add("hidden");
    img.classList.remove("hidden");
    img.onload = () => {
      fallback.classList.add("hidden");
      img.classList.remove("hidden");
    };
    img.onerror = () => {
      img.classList.add("hidden");
      fallback.classList.remove("hidden");
      fallback.innerHTML = `<strong>📖 原书第 ${pageNum} 页图片未随本部署包上传或暂未加载</strong><br/>请对照《地理信息系统导论（第8版）》纸质教材第 <b>P.${pageNum}</b> 页查阅（如需在线看原书扫描图，请确保仓库保留 <code>assets/book_pages/</code> 目录）。`;
    };
    img.src = `assets/book_pages/p${pad3(pageNum)}.jpg`;
    img.alt = `地理信息系统导论 第 ${pageNum} 页`;
    updateModalZoom();

    const idx = avail.indexOf(pageNum);
    prevBtn.classList.remove("hidden");
    nextBtn.classList.remove("hidden");
    prevBtn.disabled = idx <= 0;
    nextBtn.disabled = idx < 0 || idx >= avail.length - 1;

    if (matchingCards.length) {
      relBar.classList.remove("hidden");
      relBar.innerHTML =
        `<span style="font-weight:700;color:var(--primary)">本页对应复习卡片：</span>` +
        matchingCards
          .map(
            (c) =>
              `<button class="page-chip" data-modal-jump="${escapeHtml(c.id)}">${escapeHtml(c.title)} →</button>`
          )
          .join("");
    } else {
      relBar.classList.add("hidden");
    }

    modal.classList.remove("hidden");
  }

  function openFigureModal(src, caption) {
    state.modalMode = "figure";
    state.modalZoom = 100;
    const modal = document.getElementById("page-modal");
    const fallback = document.getElementById("modal-img-fallback");
    const img = document.getElementById("modal-img");

    document.getElementById("modal-title").textContent = "🖼 教材高清原理图";
    document.getElementById("modal-subtitle").textContent = caption || "";
    fallback.classList.add("hidden");
    img.classList.remove("hidden");
    img.onload = () => {
      fallback.classList.add("hidden");
      img.classList.remove("hidden");
    };
    img.onerror = () => {
      img.classList.add("hidden");
      fallback.classList.remove("hidden");
      fallback.textContent = "该原理图暂无法加载，请检查网络连接或资产路径。";
    };
    img.src = src;
    img.alt = caption || "原理图";
    updateModalZoom();
    document.getElementById("modal-prev-page").classList.add("hidden");
    document.getElementById("modal-next-page").classList.add("hidden");
    document.getElementById("modal-related-bar").classList.add("hidden");
    modal.classList.remove("hidden");
  }

  function updateModalZoom() {
    const img = document.getElementById("modal-img");
    const label = document.getElementById("modal-zoom-label");
    if (img) {
      img.style.maxWidth = `${Math.round(820 * (state.modalZoom / 100))}px`;
      img.style.width = `${state.modalZoom}%`;
    }
    if (label) {
      label.textContent = `${state.modalZoom}%`;
    }
  }

  function closePageModal() {
    document.getElementById("page-modal").classList.add("hidden");
  }

  // ==================== 手机搜索框开关 & 全局搜索 ====================
  function openMobileSearch() {
    const topbar = document.getElementById("topbar");
    const input = document.getElementById("global-search-input");
    if (topbar) topbar.classList.add("mobile-search-active");
    if (input) {
      input.focus();
      input.select();
    }
  }

  function closeMobileSearch() {
    const topbar = document.getElementById("topbar");
    const dd = document.getElementById("search-dropdown");
    if (topbar) topbar.classList.remove("mobile-search-active");
    if (dd) dd.classList.add("hidden");
  }

  function runSearch(query) {
    const dd = document.getElementById("search-dropdown");
    const q = query.trim();
    if (!q) {
      dd.classList.add("hidden");
      dd.innerHTML = "";
      return;
    }

    const pageMatch = q.match(/^[pP]\.?\s*(\d{1,3})$|^(\d{1,3})$/);
    if (pageMatch) {
      const pg = parseInt(pageMatch[1] || pageMatch[2], 10);
      const avail = DATA.meta.availableBookPages || [];
      const hits = allCards.filter(
        (c) =>
          (c.pages.primary || []).includes(pg) ||
          (c.pages.secondary || []).some((s) => s.page === pg)
      );
      const xrefHits = [];
      DATA.chapters.forEach((ch) => {
        (ch.crossRefs || []).forEach((xr) => {
          if ((xr.pages || []).includes(pg)) {
            xrefHits.push({ chTitle: ch.title, xr });
          }
        });
      });

      let html = "";
      if (avail.includes(pg)) {
        html += `
          <button class="search-item" data-search-open-page="${pg}">
            <div class="search-item-title">
              <span>📖 直接预览原书第 P.${pg} 页高清扫描</span>
              <span class="badge badge-imp-3">原书页</span>
            </div>
            <div class="search-item-meta">查看该页在教材中的原始内容</div>
          </button>
        `;
      }
      hits.forEach((c) => {
        html += `
          <button class="search-item" data-search-jump="${escapeHtml(c.id)}">
            <div class="search-item-title">
              <span>${escapeHtml(c.title)}</span>
              <span class="badge badge-sec">P.${pg}</span>
            </div>
            <div class="search-item-meta">${escapeHtml(c._chapterTitle)} · ${escapeHtml(c.summary.slice(0, 48))}...</div>
          </button>
        `;
      });
      xrefHits.forEach((x) => {
        html += `
          <button class="search-item" data-search-jump="${escapeHtml(x.xr.targetId)}">
            <div class="search-item-title">
              <span>${escapeHtml(x.xr.title)} (已归并)</span>
              <span class="badge badge-dedup">P.${pg}</span>
            </div>
            <div class="search-item-meta">来自 ${escapeHtml(x.chTitle)} → 点击跳转主阵地</div>
          </button>
        `;
      });
      if (!html) {
        html = `<div style="padding:12px;font-size:13px;" class="muted-text">未在已划考页码中找到第 P.${pg} 页。</div>`;
      }
      dd.innerHTML = html;
      dd.classList.remove("hidden");
      return;
    }

    const ql = q.toLowerCase();
    const scored = [];
    allCards.forEach((c) => {
      let score = 0;
      if (c.title.toLowerCase().includes(ql)) score += 10;
      if (c.summary.toLowerCase().includes(ql)) score += 6;
      if (c.sectionTitle.toLowerCase().includes(ql)) score += 4;
      if ((c.mnemonic || "").toLowerCase().includes(ql)) score += 3;
      const ptHit = c.points.some(
        (p) => p.heading.toLowerCase().includes(ql) || p.body.toLowerCase().includes(ql)
      );
      if (ptHit) score += 3;
      if (getNote(c.id).toLowerCase().includes(ql)) score += 2;
      if (score > 0) scored.push({ score, card: c });
    });
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 12);
    if (!top.length) {
      dd.innerHTML = `<div style="padding:12px;font-size:13px;" class="muted-text">未找到与“${escapeHtml(q)}”相关的知识点。</div>`;
    } else {
      dd.innerHTML = top
        .map(
          ({ card }) => `
            <button class="search-item" data-search-jump="${escapeHtml(card.id)}">
              <div class="search-item-title">
                <span>${escapeHtml(card.title)}</span>
                <span class="badge badge-sec">${escapeHtml(card.sectionCode)}</span>
              </div>
              <div class="search-item-meta">${escapeHtml(card._chapterTitle)} · ${escapeHtml(card.summary.slice(0, 52))}...</div>
            </button>
          `
        )
        .join("");
    }
    dd.classList.remove("hidden");
  }

  // ==================== 移动端侧栏 ====================
  function openMobileSidebar() {
    document.getElementById("sidebar").classList.add("mobile-open");
    document.getElementById("sidebar-backdrop").classList.remove("hidden");
  }

  function closeMobileSidebar() {
    document.getElementById("sidebar").classList.remove("mobile-open");
    document.getElementById("sidebar-backdrop").classList.add("hidden");
  }

  // ==================== 事件绑定 ====================
  function bindEvents() {
    // 顶部导航 + 手机底部导航统一监听
    document.querySelectorAll(".nav-tab, .bottom-nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });

    // 桌面 & 手机模式按钮
    document.getElementById("btn-cloze-mode").addEventListener("click", toggleClozeMode);
    document.getElementById("m-btn-cloze").addEventListener("click", toggleClozeMode);

    document.getElementById("btn-outline-mode").addEventListener("click", toggleOutlineMode);
    document.getElementById("m-btn-outline").addEventListener("click", toggleOutlineMode);

    document.getElementById("btn-all-pages").addEventListener("click", toggleAllPagesMode);
    document.getElementById("m-btn-pages").addEventListener("click", toggleAllPagesMode);

    document.getElementById("btn-theme-toggle").addEventListener("click", () => {
      applyTheme(persisted.theme === "dark" ? "light" : "dark");
    });

    document.getElementById("btn-mobile-search-open").addEventListener("click", openMobileSearch);
    document.getElementById("btn-mobile-search-close").addEventListener("click", closeMobileSearch);

    document.getElementById("btn-sidebar-toggle").addEventListener("click", openMobileSidebar);
    document.getElementById("sidebar-backdrop").addEventListener("click", closeMobileSidebar);

    document.getElementById("status-filter-pills").addEventListener("click", (e) => {
      const btn = e.target.closest(".filter-pill");
      if (!btn) return;
      state.statusFilter = btn.dataset.filter;
      document.querySelectorAll("#status-filter-pills .filter-pill").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      renderSidebar();
      if (state.activeView === "chapters") renderChapterView();
    });

    document.getElementById("chapter-list").addEventListener("click", (e) => {
      const btn = e.target.closest(".ch-nav-btn");
      if (!btn) return;
      state.activeChapterId = btn.dataset.ch;
      renderSidebar();
      renderChapterView();
      closeMobileSidebar();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    const mainEl = document.getElementById("main-content");
    mainEl.addEventListener("click", (e) => {
      const pageBtn = e.target.closest("[data-toggle-page]");
      if (pageBtn) {
        const cid = pageBtn.dataset.togglePage;
        const cardEl = document.getElementById(`card-${cid}`);
        if (!cardEl) return;
        const nowOpen = !cardEl.classList.contains("pages-open");
        cardEl.classList.toggle("pages-open", nowOpen);
        if (nowOpen) state.openPageCards.add(cid);
        else state.openPageCards.delete(cid);
        pageBtn.textContent = nowOpen ? "📖 收起页码" : "📖 页码";
        pageBtn.setAttribute("aria-expanded", String(nowOpen));
        return;
      }

      const openPg = e.target.closest("[data-open-page]");
      if (openPg) {
        openBookPageModal(parseInt(openPg.dataset.openPage, 10));
        return;
      }

      const figImg = e.target.closest("[data-fig-src]");
      if (figImg) {
        openFigureModal(figImg.dataset.figSrc, figImg.dataset.figCap);
        return;
      }

      const mBtn = e.target.closest("[data-set-mastery]");
      if (mBtn) {
        const cid = mBtn.dataset.setMastery;
        const st = mBtn.dataset.state;
        setMastery(cid, st);
        const cardEl = document.getElementById(`card-${cid}`);
        if (cardEl) {
          cardEl.classList.remove("mastery-unlearned", "mastery-fuzzy", "mastery-mastered");
          cardEl.classList.add(`mastery-${st}`);
          cardEl.querySelectorAll(".mastery-btn").forEach((b) => {
            b.classList.toggle("active", b.dataset.state === st);
          });
        }
        return;
      }

      const clozeEl = e.target.closest(".cloze-blank");
      if (clozeEl) {
        clozeEl.classList.toggle("revealed");
        return;
      }

      const revCardBtn = e.target.closest("[data-reveal-card-cloze]");
      if (revCardBtn) {
        const cardEl = document.getElementById(`card-${revCardBtn.dataset.revealCardCloze}`);
        if (cardEl) {
          const blanks = Array.from(cardEl.querySelectorAll(".cloze-blank"));
          const anyHidden = blanks.some((b) => !b.classList.contains("revealed"));
          blanks.forEach((b) => b.classList.toggle("revealed", anyHidden));
        }
        return;
      }

      const expBtn = e.target.closest("[data-expand-card]");
      if (expBtn) {
        const cid = expBtn.dataset.expandCard;
        state.expandedInOutline.add(cid);
        const cardEl = document.getElementById(`card-${cid}`);
        if (cardEl) cardEl.classList.remove("outline-collapsed");
        return;
      }

      const jumpBtn = e.target.closest("[data-jump]");
      if (jumpBtn) {
        jumpToCard(jumpBtn.dataset.jump);
        return;
      }

      const chBtn = e.target.closest("[data-switch-ch]");
      if (chBtn && !chBtn.disabled) {
        state.activeChapterId = chBtn.dataset.switchCh;
        renderSidebar();
        renderChapterView();
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      if (e.target.id === "btn-reset-filter-inline") {
        state.statusFilter = "all";
        document.querySelectorAll("#status-filter-pills .filter-pill").forEach((b) => {
          b.classList.toggle("active", b.dataset.filter === "all");
        });
        renderSidebar();
        renderChapterView();
        return;
      }

      const quizBtn = e.target.closest("[data-quiz-card]");
      if (quizBtn) {
        startSingleFlashcard(quizBtn.dataset.quizCard);
        return;
      }

      const fwTab = e.target.closest("[data-fw-tab]");
      if (fwTab) {
        state.fwTab = fwTab.dataset.fwTab;
        renderFrameworkView();
        return;
      }

      if (e.target.closest("#fc-card-3d") && !e.target.closest("#fc-btn-go-card")) {
        state.fcFlipped = !state.fcFlipped;
        document.getElementById("fc-card-3d").classList.toggle("flipped", state.fcFlipped);
        return;
      }
      if (e.target.id === "fc-btn-flip") {
        state.fcFlipped = !state.fcFlipped;
        document.getElementById("fc-card-3d").classList.toggle("flipped", state.fcFlipped);
        return;
      }
      const fcRate = e.target.closest("[data-fc-rate]");
      if (fcRate) {
        rateFlashcard(fcRate.dataset.fcRate);
        return;
      }
      if (e.target.id === "fc-btn-order" || e.target.id === "fc-btn-shuffle" || e.target.id === "fc-btn-again-shuffle") {
        buildFlashcardQueue(e.target.id !== "fc-btn-order");
        renderFlashcardView();
        return;
      }
      if (e.target.id === "fc-btn-only-todo") {
        state.fcScope = "todo";
        buildFlashcardQueue(true);
        renderFlashcardView();
        return;
      }
      if (e.target.id === "fc-reset-all-btn") {
        state.fcScope = "all";
        buildFlashcardQueue(false);
        renderFlashcardView();
        return;
      }

      const kgNode = e.target.closest("[data-kg-node], [data-kg-pick]");
      if (kgNode) {
        state.kgSelectedId = kgNode.dataset.kgNode || kgNode.dataset.kgPick;
        renderGraphView();
        return;
      }
    });

    mainEl.addEventListener("dblclick", (e) => {
      const kgNode = e.target.closest("[data-kg-node]");
      if (kgNode) {
        jumpToCard(kgNode.dataset.kgNode);
      }
    });

    mainEl.addEventListener("change", (e) => {
      if (e.target.id === "fc-scope-select") {
        state.fcScope = e.target.value;
        buildFlashcardQueue(false);
        renderFlashcardView();
      }
    });

    mainEl.addEventListener("input", (e) => {
      if (e.target.matches("[data-note-card]")) {
        setNote(e.target.dataset.noteCard, e.target.value);
      }
    });

    const searchInput = document.getElementById("global-search-input");
    const searchDropdown = document.getElementById("search-dropdown");
    searchInput.addEventListener("input", () => runSearch(searchInput.value));
    searchInput.addEventListener("focus", () => {
      if (searchInput.value.trim()) runSearch(searchInput.value);
    });
    searchDropdown.addEventListener("click", (e) => {
      const jBtn = e.target.closest("[data-search-jump]");
      if (jBtn) {
        closeMobileSearch();
        jumpToCard(jBtn.dataset.searchJump);
        return;
      }
      const pBtn = e.target.closest("[data-search-open-page]");
      if (pBtn) {
        closeMobileSearch();
        openBookPageModal(parseInt(pBtn.dataset.searchOpenPage, 10));
      }
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".search-wrap") && !e.target.closest("#btn-mobile-search-open")) {
        searchDropdown.classList.add("hidden");
      }
    });

    document.getElementById("modal-close").addEventListener("click", closePageModal);
    document.getElementById("page-modal-backdrop").addEventListener("click", closePageModal);
    document.getElementById("modal-zoom-in").addEventListener("click", () => {
      state.modalZoom = Math.min(200, state.modalZoom + 20);
      updateModalZoom();
    });
    document.getElementById("modal-zoom-out").addEventListener("click", () => {
      state.modalZoom = Math.max(60, state.modalZoom - 20);
      updateModalZoom();
    });
    document.getElementById("modal-prev-page").addEventListener("click", () => {
      const avail = DATA.meta.availableBookPages || [];
      const idx = avail.indexOf(state.modalBookPage);
      if (idx > 0) openBookPageModal(avail[idx - 1]);
    });
    document.getElementById("modal-next-page").addEventListener("click", () => {
      const avail = DATA.meta.availableBookPages || [];
      const idx = avail.indexOf(state.modalBookPage);
      if (idx >= 0 && idx < avail.length - 1) openBookPageModal(avail[idx + 1]);
    });
    document.getElementById("modal-related-bar").addEventListener("click", (e) => {
      const jBtn = e.target.closest("[data-modal-jump]");
      if (jBtn) {
        closePageModal();
        jumpToCard(jBtn.dataset.modalJump);
      }
    });

    // 备份 & 跨设备口令同步弹窗
    const backupModal = document.getElementById("backup-modal");
    document.getElementById("btn-backup-modal").addEventListener("click", () => {
      document.getElementById("backup-feedback").textContent = "";
      document.getElementById("sync-feedback").textContent = "";
      backupModal.classList.remove("hidden");
    });
    document.getElementById("backup-close").addEventListener("click", () => backupModal.classList.add("hidden"));
    document.getElementById("backup-modal-backdrop").addEventListener("click", () => backupModal.classList.add("hidden"));

    document.getElementById("btn-gen-sync-code").addEventListener("click", () => {
      const box = document.getElementById("sync-code-box");
      const fb = document.getElementById("sync-feedback");
      try {
        const code = encodeSyncCode();
        box.value = code;
        box.select();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(
            () => {
              fb.style.color = "var(--success)";
              fb.textContent = "✅ 已生成并复制到剪贴板！在另一台设备上粘贴应用即可同步进度。";
            },
            () => {
              fb.style.color = "var(--success)";
              fb.textContent = "✅ 同步口令已生成在下方输入框，请手动全选复制。";
            }
          );
        } else {
          fb.style.color = "var(--success)";
          fb.textContent = "✅ 同步口令已生成在下方输入框，请手动全选复制。";
        }
      } catch (err) {
        fb.style.color = "var(--danger)";
        fb.textContent = "❌ 生成同步口令失败：" + err.message;
      }
    });

    document.getElementById("btn-apply-sync-code").addEventListener("click", () => {
      const box = document.getElementById("sync-code-box");
      const fb = document.getElementById("sync-feedback");
      try {
        const imported = decodeSyncCode(box.value);
        persisted.mastery = Object.assign({}, persisted.mastery, imported.mastery);
        persisted.notes = Object.assign({}, persisted.notes, imported.notes);
        savePersistedState();
        updateGlobalMasteryUI();
        renderSidebar();
        switchView(state.activeView, true);
        fb.style.color = "var(--success)";
        fb.textContent = `✅ 同步成功！已合并 ${Object.keys(imported.mastery).length} 条掌握记录与 ${Object.keys(imported.notes).length} 条笔记。`;
      } catch (err) {
        fb.style.color = "var(--danger)";
        fb.textContent = "❌ 口令无效，请确认完整复制了 GIS1:... 字符串。";
      }
    });

    document.getElementById("btn-export-progress").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(persisted, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "GIS复习进度备份.json";
      a.click();
      URL.revokeObjectURL(url);
      document.getElementById("backup-feedback").textContent = "✅ 已导出 GIS复习进度备份.json";
    });

    document.getElementById("input-import-progress").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const obj = JSON.parse(reader.result);
          if (obj && typeof obj === "object") {
            persisted.mastery = obj.mastery || {};
            persisted.notes = obj.notes || {};
            if (obj.theme === "dark" || obj.theme === "light") applyTheme(obj.theme);
            savePersistedState();
            updateGlobalMasteryUI();
            renderSidebar();
            switchView(state.activeView, true);
            document.getElementById("backup-feedback").textContent = "✅ 学习进度导入成功！";
          }
        } catch (err) {
          document.getElementById("backup-feedback").textContent = "❌ 文件格式无效，请确认是导出的 JSON 备份。";
        }
      };
      reader.readAsText(file);
    });

    document.getElementById("btn-reset-progress").addEventListener("click", () => {
      if (window.confirm("确定要清空所有卡片的掌握标记与个人笔记吗？")) {
        persisted.mastery = {};
        persisted.notes = {};
        savePersistedState();
        updateGlobalMasteryUI();
        renderSidebar();
        switchView(state.activeView, true);
        document.getElementById("backup-feedback").textContent = "已重置全部学习记录。";
      }
    });

    document.addEventListener("keydown", (e) => {
      const tag = (e.target && e.target.tagName) || "";
      const isTyping = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      if (e.key === "Escape") {
        closePageModal();
        backupModal.classList.add("hidden");
        closeMobileSearch();
        return;
      }

      if ((e.key === "/" && !isTyping) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        openMobileSearch();
        return;
      }

      const modalOpen =
        !document.getElementById("page-modal").classList.contains("hidden") ||
        !backupModal.classList.contains("hidden");

      if (!isTyping && !modalOpen && state.activeView === "flashcards" && state.fcIndex < state.fcQueue.length) {
        if (e.code === "Space") {
          e.preventDefault();
          state.fcFlipped = !state.fcFlipped;
          const card3d = document.getElementById("fc-card-3d");
          if (card3d) card3d.classList.toggle("flipped", state.fcFlipped);
        } else if (e.key === "1") {
          rateFlashcard("forgot");
        } else if (e.key === "2") {
          rateFlashcard("fuzzy");
        } else if (e.key === "3") {
          rateFlashcard("good");
        }
      }
    });
  }

  function syncTopbarHeight() {
    const topbar = document.getElementById("topbar");
    if (topbar) {
      document.documentElement.style.setProperty("--topbar-h", `${topbar.offsetHeight}px`);
    }
  }

  function registerServiceWorker() {
    if (window.location.protocol.indexOf("http") === 0 && "serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch(() => {
          // ignore sw error silently
        });
      });
    }
  }

  function init() {
    applyTheme(persisted.theme);
    updateGlobalMasteryUI();
    renderSidebar();
    syncModeToggleUI();
    switchView("chapters");
    bindEvents();
    syncTopbarHeight();
    window.addEventListener("resize", syncTopbarHeight);
    if (typeof window.ResizeObserver === "function") {
      const topbar = document.getElementById("topbar");
      if (topbar) {
        new window.ResizeObserver(syncTopbarHeight).observe(topbar);
      }
    }
    registerServiceWorker();
  }

  init();
})();
