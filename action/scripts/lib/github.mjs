// SPDX-License-Identifier: MPL-2.0
import { appendFile } from "node:fs/promises";

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Minimal REST client for the calls CI needs. `fetchFn` is injected for tests. */
export class GitHubClient {
  constructor({ token, repository, apiUrl = "https://api.github.com", fetchFn = fetch }) {
    this.token = token;
    this.repository = repository;
    this.apiUrl = apiUrl;
    this.fetchFn = fetchFn;
  }

  async request(method, path, body) {
    const response = await this.fetchFn(`${this.apiUrl}/repos/${this.repository}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return null;
    const text = await response.text();
    if (!response.ok) throw new GitHubError(response.status, `${method} ${path} -> ${response.status}: ${text}`);
    return text ? JSON.parse(text) : null;
  }

  async paginate(path) {
    const all = [];
    for (let page = 1; ; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const items = await this.request("GET", `${path}${sep}per_page=100&page=${page}`);
      all.push(...items);
      if (items.length < 100) return all;
    }
  }

  getPull(number) {
    return this.request("GET", `/pulls/${number}`);
  }

  listOpenPulls() {
    return this.paginate("/pulls?state=open");
  }

  listCommitPulls(sha) {
    return this.request("GET", `/commits/${sha}/pulls`);
  }

  listComments(number) {
    return this.paginate(`/issues/${number}/comments`);
  }

  createComment(number, body) {
    return this.request("POST", `/issues/${number}/comments`, { body });
  }

  updateComment(id, body) {
    return this.request("PATCH", `/issues/comments/${id}`, { body });
  }

  setStatus(sha, { state, description, context, targetUrl }) {
    return this.request("POST", `/statuses/${sha}`, {
      state,
      context,
      description: description.slice(0, 140),
      target_url: targetUrl,
    });
  }
}

/** Writes step outputs to $GITHUB_OUTPUT (or prints them when run locally). */
export class ActionOutputs {
  constructor(file, log = console.log) {
    this.file = file;
    this.log = log;
  }

  async set(name, value) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (!this.file) {
      this.log(`output ${name}=${text}`);
      return;
    }
    await appendFile(this.file, `${name}<<__DOCENGINE_EOF__\n${text}\n__DOCENGINE_EOF__\n`);
  }
}
