---
title: 用 Astro 把手寫的履歷頁改成可以寫文章的個人網站
date: 2026-10-15
description: 從一個單頁 HTML 履歷，改成用 Astro 建置、Markdown 寫文章、push 就自動部署到 GitHub Pages 的個人網站。記錄選擇的理由、專案結構和踩到的幾個坑。
tags: [Astro, GitHub Pages, GitHub Actions]
draft: false
---

這個網站一開始只是一頁手寫的 HTML 履歷，直接放在 GitHub Pages 上。後來想開始寫技術文章，才發現手寫 HTML 撐不了多久：每篇文章都要複製一樣的頁首、頁尾和樣式，改一次導覽列就要改每個檔案。

所以我把它改成用靜態網站產生器建置。這篇記錄整個過程。

## 為什麼選 Astro，而不是 Hugo

兩個都是常見的靜態網站產生器：用 Markdown 寫內容，建置時產生純 HTML，很適合放在 GitHub Pages。

| | Hugo | Astro |
|---|---|---|
| 執行環境 | 單一 Go 執行檔 | Node.js |
| 版型語法 | Go template | 類 HTML 的 `.astro` 元件 |
| 適合 | 套現成主題、專心寫文章 | 想自己控制設計、加互動元件 |

我選 Astro 主要是因為**現有的履歷頁幾乎可以原封不動搬進去**。`.astro` 檔就是 HTML 加上最上面一段 frontmatter 腳本，原本的 HTML 換個副檔名就能用；換成 Hugo 的話，得改寫成 Go template。

另一個原因是之後想在文章裡放互動 demo（例如訂單狀態機），Astro 可以直接在頁面裡用元件。

## 專案結構

```
homepage/
├── astro.config.mjs
├── public/
│   └── avatar.jpg            # 原樣複製到輸出目錄
├── src/
│   ├── content.config.ts     # 定義文章的欄位
│   ├── content/posts/        # 文章都放這裡，一篇一個 .md
│   ├── layouts/Base.astro    # 共用的 <head>、導覽列、頁尾
│   ├── pages/
│   │   ├── index.astro       # 首頁（履歷）
│   │   └── posts/
│   │       ├── index.astro   # 文章列表
│   │       └── [...id].astro # 文章內頁
│   └── styles/global.css
└── .github/workflows/deploy.yml
```

`src/pages/` 底下的檔案路徑就是網址，`posts/index.astro` 對應 `/posts/`。

## 共用版型

原本 HTML 裡的 `<head>`、樣式和頁尾，抽到 `Base.astro`，頁面內容用 `<slot />` 插進來：

```astro
---
import '../styles/global.css';
const { title, description } = Astro.props;
---
<html lang="zh-Hant-TW">
<head>
  <title>{title}</title>
  <meta name="description" content={description}>
</head>
<body>
  <nav>…</nav>
  <slot />
  <footer>…</footer>
</body>
</html>
```

首頁就只剩內容：

```astro
---
import Base from '../layouts/Base.astro';
---
<Base title="黃斌魁 · 後端工程師">
  <header class="hero">…</header>
  <section>…</section>
</Base>
```

## 用 Content Collections 管理文章

在 `src/content.config.ts` 定義文章有哪些欄位。寫錯欄位或漏填，建置時就會直接報錯，不會等到上線才發現：

```ts
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts };
```

我加了一個 `draft` 欄位。查詢文章時，開發模式顯示全部，正式建置只取非草稿：

```ts
const posts = await getCollection('posts',
  ({ data }) => import.meta.env.DEV || !data.draft);
```

這樣寫到一半的文章可以先 commit，本機預覽看得到，但不會被發布出去。

文章內頁用 `getStaticPaths` 替每篇文章產生一個頁面：

```astro
---
import { getCollection, render } from 'astro:content';

export async function getStaticPaths() {
  const posts = await getCollection('posts',
    ({ data }) => import.meta.env.DEV || !data.draft);
  return posts.map((post) => ({ params: { id: post.id }, props: { post } }));
}

const { post } = Astro.props;
const { Content } = await render(post);
---
<h1>{post.data.title}</h1>
<Content />
```

之後寫文章就只要在 `src/content/posts/` 新增一個 Markdown 檔。

## 部署到 GitHub Pages

用 GitHub Actions 建置和部署，Astro 官方有現成的 action：

```yaml
name: 部署到 GitHub Pages

on:
  push:
    branches: [main]

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: withastro/action@v6

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

現在只要 push 到 `main`，大約一分鐘網站就會更新。

## 踩到的坑

### 1. 專案網站要設定 `base`

這個 repo 叫 `homepage`，所以網址是 `https://<帳號>.github.io/homepage/`，不是根網址。沒設定 `base` 的話，CSS、圖片和連結都會指到 `/`，整個網站壞掉。

```js
// astro.config.mjs
export default defineConfig({
  site: 'https://benny19930812.github.io',
  base: '/homepage',
});
```

設定之後，頁面裡的連結也要記得加上 base，不能直接寫 `/posts/`：

```astro
---
const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
---
<a href={`${base}posts/`}>文章</a>
<img src={`${base}avatar.jpg`} alt="大頭照">
```

`BASE_URL` 有沒有結尾斜線會跟著設定變，所以我統一補成結尾有 `/`。

如果 repo 名稱取成 `<帳號>.github.io`，網站就會在根網址，不需要設定 `base`。

### 2. 要把 Pages 的來源改成 GitHub Actions

原本的單頁版本是讓 GitHub Pages 直接讀 `main` 分支的檔案。改成 Astro 之後，`main` 裡放的是原始碼，不是建置好的 HTML，所以要到 repo 的 **Settings → Pages → Build and deployment**，把 Source 改成 **GitHub Actions**。

沒改的話，workflow 會成功，但網站一直顯示舊的內容，很容易以為是快取問題。

### 3. 程式碼區塊在深色模式下很刺眼

Astro 內建用 Shiki 做語法高亮，預設只有一個主題。我的網站有深淺兩種配色，所以改成雙主題：

```js
markdown: {
  shikiConfig: {
    themes: { light: 'github-light', dark: 'github-dark' },
  },
},
```

Shiki 會把深色主題的顏色放在 CSS 變數 `--shiki-dark` 裡，再用 CSS 在深色模式時切換過去：

```css
@media (prefers-color-scheme: dark) {
  .astro-code,
  .astro-code span {
    color: var(--shiki-dark) !important;
    background-color: var(--shiki-dark-bg) !important;
  }
}
```

### 4. `astro dev` 執行完就結束了

我用的是 Astro 7，執行 `npm run dev` 之後指令馬上結束，只印出一行網址。一開始以為是啟動失敗，後來才發現開發伺服器改成在背景常駐了，要用指令管理：

```bash
npx astro dev status   # 查看狀態
npx astro dev logs     # 查看 log
npx astro dev stop     # 關閉
```

## 小結

改完之後，寫文章的流程變成：

1. 在 `src/content/posts/` 新增一個 `.md` 檔
2. `npm run dev` 本機預覽
3. commit、push，等一分鐘

比起手寫 HTML，省下最多的是「不用再想版型」。接下來就是把時間花在寫內容上了。
