// 部署辅助:创建 GitHub 仓库 + 开启 Pages
const token = process.env.GH_TOKEN;
const base = 'https://api.github.com';
async function api(path, method, body) {
  const res = await fetch(base + path, {
    method: method || 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      'User-Agent': 'dsh-deploy',
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch (e) {}
  return { status: res.status, json: j, text };
}
(async () => {
  // 创建仓库(公开)
  const r = await api('/user/repos', 'POST', {
    name: 'baodaxiaoyuanmi',
    public: true,
    description: 'NEO STRIKE 量子突击 - 科幻风 3D FPS 网页游戏 (Three.js 单文件)',
    has_issues: false,
    has_wiki: false,
    auto_init: false
  });
  if (r.status === 201) {
    console.log('CREATE REPO OK ->', r.json.full_name, r.json.html_url);
  } else if (r.status === 422) {
    console.log('REPO ALREADY EXISTS:', r.json.message);
  } else {
    console.log('CREATE REPO FAILED:', r.status, r.text);
    process.exit(1);
  }
})().catch((e) => { console.log('API ERROR:', e.message); process.exit(1); });
