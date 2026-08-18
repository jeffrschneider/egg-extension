import { sameSite, a2aEndpoint, acceptsAnonymous, anchorMatches } from "../src/background/site-detect.js";
let fail = 0;
const ok = (name, got, want) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) { fail++; console.log("FAIL " + name + ": got " + JSON.stringify(got) + " want " + JSON.stringify(want)); }
  else console.log("ok   " + name);
};

// The endpoint must be on the site you are actually looking at.
ok("same host", sameSite("acme.com", "acme.com"), true);
ok("www page, api endpoint", sameSite("www.acme.com", "api.acme.com"), true);
ok("docs page, api endpoint", sameSite("docs.acme.com", "api.acme.com"), true);
ok("page under endpoint", sameSite("docs.acme.com", "acme.com"), true);
ok("borrowing a stranger's agent", sameSite("evil.example", "walmart.com"), false);
ok("lookalike suffix", sameSite("acme.com", "acme.com.evil.example"), false);
ok("prefix lookalike", sameSite("acme.com", "notacme.com"), false);
ok("country registry is not a site", sameSite("shop.bbc.co.uk", "evil.co.uk"), false);
ok("same country registrable", sameSite("www.bbc.co.uk", "api.bbc.co.uk"), true);

// Which endpoint we speak to, and in which dialect.
ok("1.0 card", a2aEndpoint({ supportedInterfaces: [{ url: "https://a.com/rpc", protocolBinding: "JSONRPC" }] }),
   { url: "https://a.com/rpc", dialect: "v1" });
ok("1.0 card, no JSON-RPC binding", a2aEndpoint({ supportedInterfaces: [{ url: "https://a.com/g", protocolBinding: "GRPC" }] }), null);
ok("older card", a2aEndpoint({ url: "https://a.com/a2a", preferredTransport: "JSONRPC" }), { url: "https://a.com/a2a", dialect: "legacy" });
ok("older card, transport unstated", a2aEndpoint({ url: "https://a.com/a2a" }), { url: "https://a.com/a2a", dialect: "legacy" });
ok("older card, other transport", a2aEndpoint({ url: "https://a.com/a2a", preferredTransport: "GRPC" }), null);
ok("no endpoint at all", a2aEndpoint({ name: "x" }), null);

// Whether a visit, which carries nothing, will be let in.
ok("no security stated", acceptsAnonymous({}), true);
ok("anonymous listed", acceptsAnonymous({ security: [{ apiKey: [] }, {}] }), true);
ok("credential required", acceptsAnonymous({ security: [{ apiKey: [] }] }), false);
ok("empty requirement list", acceptsAnonymous({ security: [] }), false);

// Unchanged: our own anchor rule.
ok("anchor whole labels", anchorMatches("acme.com.evil.example", "acme.com"), false);

console.log(fail ? "\n" + fail + " FAILED" : "\nall gates pass");
process.exit(fail ? 1 : 0);
