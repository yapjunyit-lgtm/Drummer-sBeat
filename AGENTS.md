<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Reasoning & Critical Thinking

- Before answering, check whether the question contains false premises, logical leaps, or missing information — and flag them.
- Do not flatter or echo the user; exercise independent judgment.
- Distinguish clearly between facts, speculations, and subjective opinions.
- Verify sources whenever numbers, key figures, or conclusions are involved.
- Disagree directly when needed, and provide supporting rationale, potential risks, and alternative explanations.
- Proactively point out variables, costs, and biases the user may have overlooked.

## Git identity & pushes (this repo)

- **Push identity here is `yapjunyit-lgtm` / `yapjunyit@gmail.com`.** The
  **global** GitHub account on this machine stays **`dashoilai5-lab`** for every
  other repo, agent, and thread. Never switch the global account just to get a
  push through from this repository.
- **Confirm the identity before every push — never assume it.** The committed
  hook `.githooks/pre-push` does this automatically and aborts the push when the
  credential does not resolve to `yapjunyit-lgtm` or lacks push access. Enable
  it once per clone:

  ```bash
  git config core.hooksPath .githooks
  ```

- Pushes here work regardless of which account is active, because the repo pins
  its own credential (repo-local, never committed):

  ```bash
  git config --local credential.https://github.com.helper ''
  git config --local --add credential.https://github.com.helper '!f() { echo username=x-access-token; echo "password=$(gh auth token --user yapjunyit-lgtm)"; }; f'
  ```

- Verify any time (read-only, prints no secrets):

  ```bash
  git config --local --get-all credential.https://github.com.helper
  GH_TOKEN=$(gh auth token --user yapjunyit-lgtm) gh api user --jq .login
  ```

- Deliberate one-off bypass only (not for routine use):

  ```bash
  SKIP_IDENTITY_CHECK=1 git push
  ```
