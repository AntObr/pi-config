# Manual subagent browser independence check

Use this when Chromium is not installed in the automated test environment or when you need to verify real Pi subagents rather than the Node process harness in `process-browser-independence.test.ts`.

1. Start a local cookie echo server:

```bash
node - <<'NODE'
const http = require('node:http');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  res.setHeader('content-type', 'text/html');
  const owner = url.pathname.match(/^\/set\/(.+)$/)?.[1];
  if (owner) {
    res.setHeader('set-cookie', `owner=${owner}; Path=/; SameSite=Lax`);
    res.end(`<!doctype html><title>set ${owner}</title><main>set ${owner}</main><a id="${owner}" href="/echo">echo</a>`);
    return;
  }
  res.end(`<!doctype html><title>echo</title><main>cookie ${req.headers.cookie ?? 'none'}</main><a id="echo" href="/echo">echo</a>`);
});
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  console.log(`server=http://127.0.0.1:${port}`);
});
NODE
```

2. Copy the printed URL into `SERVER` and run a Pi parent plus two subagents:

```bash
SERVER=http://127.0.0.1:PORT
pi -p "Use browser_navigate to open $SERVER/set/parent in the parent default session, then $SERVER/echo, then browser_inspect. Spawn two subagents. In subagent one, use browser_navigate in the default session for $SERVER/set/first then $SERVER/echo, inspect, click element e1, close default, and report the visible cookie text. In subagent two, use browser_navigate in the default session for $SERVER/set/second then $SERVER/echo, inspect, click element e1, and report the visible cookie text before and after subagent one closes. After collecting both subagents, inspect the parent default session again and report the visible cookie text."
```

Pass criteria:

- Parent inspection shows `cookie owner=parent` before and after subagent cleanup.
- Sibling inspections show `cookie owner=first` and `cookie owner=second` while both use session name `default`.
- Element ID `e1` works separately in each process. The text ID may match, but it must target that process's page.
- Closing `default` in one subagent does not close the parent session or the sibling session.
