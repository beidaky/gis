# GIS 知识高效复习工作台 · GitHub Pages 上线指南

本文件夹内容为纯静态单页应用，已专门针对 **GitHub Pages + Cloudflare 自定义域名（`gis.xxuus.com`）** 以及 **手机随身刷题 / PWA 添加到桌面** 完成深度适配。

---

## 一、三步快速上线到 `https://gis.xxuus.com`

### 第 1 步：新建 GitHub 仓库并上传本文件夹全部内容
1. 在 GitHub 创建一个新仓库（建议命名如 `gis-notes`；如使用免费版 GitHub 账户托管 Pages，请先选 `Public` 公开仓库——本包内已配置 `robots.txt` 与 `noindex` 防止搜索引擎收录）。
2. 将**本文件夹内所有文件与子目录**推送到该仓库 `main` 分支根目录：
   ```bash
   cd "F:\Agent项目\GIS知识点\GIS知识点-GitHubPages上线包"
   git init
   git add .
   git commit -m "Deploy GIS review workbench"
   git branch -M main
   git remote add origin https://github.com/<你的GitHub用户名>/<仓库名>.git
   git push -u origin main
   ```

> **提示**：如想更换子域名（例如改为 `study.xxuus.com`），只需打开本目录中的 `CNAME` 文件把 `gis.xxuus.com` 改为你想要的子域名即可。

---

### 第 2 步：在 Cloudflare 配置 DNS 解析
1. 登录 Cloudflare，进入 `xxuus.com` 的 **DNS -> 记录 (Records)** 页面。
2. 点击 **添加记录 (Add record)**：
   - **类型 (Type)**：`CNAME`
   - **名称 (Name)**：`gis`（代表 `gis.xxuus.com`）
   - **目标 (Target)**：`<你的GitHub用户名>.github.io`
   - **代理状态 (Proxy status)**：⚠️ **首次验证 HTTPS 证书前，建议先关闭橙色云朵（设为 `仅 DNS / DNS only`）**，等 GitHub Pages 成功签发证书并勾选 `Enforce HTTPS` 后，再按需开启橙云加速！
3. ⚠️ **Cloudflare SSL 避坑提醒**：如果你后续开启了 Cloudflare 橙色云朵代理，务必进入 Cloudflare 左侧 **SSL/TLS -> 概述**，将加密模式设为 **`完全 (Full)`** 或 **`完全(严格) Full (Strict)`**。切勿选 `灵活 (Flexible)`，否则会与 GitHub Pages 的强制 HTTPS 形成无限重定向循环！

---

### 第 3 步：在 GitHub 仓库开启 Pages 并绑定域名
1. 打开 GitHub 仓库页面 -> **Settings -> Pages**。
2. **Source** 选 `Deploy from a branch`，Branch 选 `main`、文件夹选 `/ (root)`，点击 `Save`。
3. 在 **Custom domain** 栏应会自动识别 `gis.xxuus.com`（来自仓库内的 `CNAME` 文件）；等待几分钟 DNS 与 TLS 证书校验通过后，勾选 **`Enforce HTTPS`**。
4. 浏览器访问 `https://gis.xxuus.com` 即可使用！

---

## 二、手机随身高效复习技巧

1. **添加到手机主屏幕（PWA 离线可用）**：
   - iPhone (Safari)：底部菜单 `分享` -> `添加到主屏幕`；
   - Android (Chrome / Edge / 夸克)：右上角菜单 -> `添加到主屏幕` / `安装应用`。
   - 之后即可像原生 App 一样全屏打开，支持已浏览内容离线缓存（地铁无信号照常抽背闪卡与挖空记忆）。
2. **手机 ↔ 电脑同步学习进度与笔记**：
   - 点击右上角 `⚙️` 打开备份弹窗，点击 **「生成并复制同步口令」**，发到微信/QQ 文件传输助手；在另一台设备上打开 `⚙️` 粘贴同步口令点击 **「还原同步进度」** 即可一键合并同步。
3. **关于原书参考页图片公开说明**：
   - 本部署包 `assets/book_pages/` 包含 174 张从教材 PDF 导出的参考页扫描图，仅在用户点击具体页码胶囊时按需加载。
   - 若你因版权/仓库公开原因不希望上传全书扫描页，**只需直接删除 `assets/book_pages/` 文件夹再推送即可**，网页中的页码展开与所有背诵功能仍 100% 正常工作（点页码预览会自动给出优雅页码提示，不会报错）。
