// Copied from https://github.com/sebastiandedeyne/sebastiandedeyne.com/blob/f9c19f78e7a7b57562059a62154f0c9d9641267b/assets/js/webmentions.js.

const container = document.querySelector("[data-webmentions]");

if (container) {
  renderWebmentions(container);
}

async function renderWebmentions(container) {
  const webmentions = await getWebmentions(container.dataset.webmentions);

  if (webmentions.length === 0) {
    return;
  }

  const list = document.createElement("ul");
  list.className = "webmentions";

  webmentions.forEach(webmention => {
    list.appendChild(renderWebmention(webmention));
  });

  container.appendChild(list);
}

function getWebmentions(target) {
  return fetch(`https://webmention.io/api/mentions.jf2?target=${target}&per-page=999`)
    .then(response => response.json())
    .then(data => data.children);
}

function renderWebmention(webmention) {
  const action = {
    "in-reply-to": "replied",
    "like-of": "liked",
    "repost-of": "reposted",
    "mention-of": "mentioned"
  }[webmention["wm-property"]];

  const rendered = document.importNode(
    document.getElementById("webmention-template").content,
    true
  );

  function set(selector, attribute, value) {
    rendered.querySelector(selector)[attribute] = value;
  }

  set(".webmention-author", "href", webmention.author.url || webmention.url);
  set(".webmention-author-avatar", "src", webmention.author.photo);
  set(".webmention-author-avatar", "alt", `Photo of ${webmention.author.name}`);
  set(".webmention-author-name", "textContent", webmention.author.name);
  set(".webmention-action", "href", webmention.url);

  set(
    ".webmention-action",
    "textContent",
    `${action} on ${webmention["wm-received"].substr(0, 10)}`
  );

  if (webmention.content) {
    set(
      ".webmention-content",
      "innerHTML",
      // Emojis come through as "????" which makes for some very rude replies lmao.
      (webmention.content.html || webmention.content.text | "").replace("????", "")
    );
  }

  return rendered;
}
