// Generated from collector/allowlist.json and src/rules.js by `npm run generate`. Do not edit.
//
// pharo-agent-telemetry's filter. The agent passes every request the tools
// send it through this module, and sends the collector only what it returns:
// PLexus's and MCP's spans, each attribute in the shape the participants
// page gives, times to the week, ids replaced by a keyed hash. The key is
// telemetry-transform.key, beside this file; it never leaves this machine.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const version = "0.1.0";

const allowlist = {
  "$comment": "What is kept, and in what shape. `npm run generate` writes, from this file and collector/catalog.json (the tools and words `npm run catalog` reads in the projects' source), the filter `join` installs on a participant's machine (src/telemetry-transform.mjs), the collector's configuration (collector/otelcol.yaml), which applies the same rules again, and docs/participants.md; a test fails when any is out of date. A span is kept only from the services listed, with their scope, one of their span names, and the kinds and attributes a service `requires`. Every attribute not listed is dropped; a listed one is kept only from the services in `from` (both when absent), with the type given, and only when its value has the shape given (and, with `words`, is made of `vocabulary` words in that form: a name, or a JSON pointer of names), else it is dropped, or replaced by `otherwise`; a list with an element of another shape is dropped, but for `published`, whose elements not in a `published` set become `otherwise`. `extract` keeps the first group of a pattern, per service; `when` keeps a resource attribute only beside another's value; `beside` keeps an attribute only beside another that holds a value of its set, not its `otherwise`. `name` marks a name of the tool called: dropped (or replaced by `nameOther`) on a pharo-mcp span whose origin is other for a tool no project publishes, and on a plexus span unless it is for one of PLexus's own tools it did not forward. `own` marks what MCP says only of its own answer: dropped on a pharo-mcp span whose origin is other, for a tool no project publishes. `tool` marks the tool's name: kept when a project publishes it; else, on a pharo-mcp span whose origin is mcp or unknown, when it is made of vocabulary words; else `otherwise`.",
  "services": {
    "plexus": {
      "scope": "@evref-bl/plexus",
      "spans": ["tools/call", "tools/list", "plexus.image.create", "plexus.image.start", "plexus.image.stop", "plexus.image.delete"],
      "tools": "PLexus tools",
      "requires": ["session.id"]
    },
    "pharo-mcp": {
      "scope": "mcp-pharo",
      "spans": ["tools/call"],
      "kinds": ["server"],
      "requires": ["session.id"]
    }
  },
  "published": ["MCP tools", "PLexus tools", "pharo-image-fs tools"],
  "vocabulary": ["project words", "guessed words"],
  "patterns": {
    "identifier": "^[A-Za-z_][A-Za-z0-9_-]{0,63}$",
    "version": "^[0-9]{1,4}(?:\\.[0-9]{1,4}){0,2}(?:-(?:alpha|beta|rc)(?:\\.[0-9]{1,4})?)?$",
    "date": "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
    "product name": "^[A-Za-z][A-Za-z0-9 ._-]{0,63}$",
    "text": "^[\\s\\S]+$",
    "JSON pointer": "^(?:/[A-Za-z0-9_-]{1,64}){0,8}$",
    "option": "^[A-Za-z_][A-Za-z0-9_-]{0,63}(?:\\.[A-Za-z_][A-Za-z0-9_-]{0,63}){0,3}(?:\\[\\]|=[A-Za-z0-9_.-]{1,64})?$",
    "code": "^-?[0-9]{1,6}$",
    "variant": "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"
  },
  "sets": {
    "OS types": ["windows", "linux", "darwin", "freebsd", "netbsd", "openbsd", "dragonflybsd", "hpux", "aix", "solaris", "z_os"],
    "PLexus error codes": ["invalid-name", "no-such-image", "image-exists", "image-running", "being-started", "building", "not-running", "starting", "no-endpoint", "unknown-template", "ambiguous-template", "script-not-found", "create-failed", "start-failed", "stop-failed", "save-failed", "stopped-unsaved", "launcher-failed", "invalid-arguments", "no-image-running", "several-images", "none-takes-calls"],
    "call failures": ["tool_error", "_OTHER", "timeout", "refused", "closed", "cancelled"],
    "exception classes": ["Abort", "ArgumentsCountMismatch", "ArithmeticError", "AssertionFailure", "BlockCannotReturn", "CannotReturn", "CollectionIsEmpty", "ConfirmationRequest", "ContextCannotReturn", "DomainError", "DuplicatedSlotName", "DuplicatedVariableError", "Error", "Exception", "ExtensionConflictError", "IllegalResumeAttempt", "IncompatibleLayoutConflict", "InformativeNotification", "InstanceVariableNotFound", "InvalidSlotName", "KeyNotFound", "MessageNotUnderstood", "ModificationForbidden", "NewUndeclaredWarning", "NonBooleanReceiver", "NotFound", "NotYetImplemented", "Notification", "OutOfMemory", "PackageConflictError", "PrimitiveFailed", "ProcessAlreadyTerminating", "SelectorException", "ShouldBeImplemented", "ShouldNotImplement", "SimulationExceptionWrapper", "SizeMismatch", "SlotNotFound", "SubclassResponsibility", "SubscriptOutOfBounds", "SystemNotification", "TimedOut", "UndeclaredVariableError", "UndeclaredVariableRead", "UndeclaredVariableWrite", "UnhandledError", "UnhandledException", "UnwindError", "ValueNotFound", "Warning", "ZeroDivide", "MCPCommandError", "MCPHeaderMismatch", "MCPResourceNotFound", "MCPSyntaxError", "MCPUnsupportedProtocolVersion", "MCPInvalidToolInput", "MCPMissingPromptArgument", "MCPUnknownCompletionReference", "MCPUnknownPrompt", "AbortError", "AggregateError", "EvalError", "RangeError", "ReferenceError", "SyntaxError", "SystemError", "TimeoutError", "TypeError", "URIError"],
    "schema keywords": ["type", "enum", "const", "required", "properties", "additionalProperties", "patternProperties", "propertyNames", "minProperties", "maxProperties", "dependentRequired", "items", "prefixItems", "contains", "minItems", "maxItems", "uniqueItems", "minLength", "maxLength", "pattern", "format", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "oneOf", "anyOf", "allOf", "not", "notBlank", "notEmpty", "methodReference", "selectionRequired"],
    "agent hosts": ["@cline/core", "augment-mcp-client", "claude-ai", "claude-code", "Cline", "Code - OSS", "codex-mcp-client", "continue-cli-client", "continue-client", "crush", "cursor-vscode", "dev.warp.Warp", "gemini-cli-mcp-client", "github-copilot-developer", "goose", "goose-cli", "goose-desktop", "hermes-mcp-client", "inspector", "inspector-cli", "inspector-client", "inspector-tui", "jetbrains-ai-assistant-client", "junie-client", "kilo", "Kilo Code", "kiro", "mcp-inspector", "opencode", "plexus", "Q DEV CLI", "qwen-code-mcp-client", "Roo Code", "Visual Studio Code", "Visual Studio Code - Insiders", "VSCodium", "VSCodium - Insiders", "Windsurf", "windsurf-client", "Zed"],
    "guessed words": ["accessor", "accessors", "action", "add", "after", "alias", "all", "any", "append", "apply", "arg", "args", "argument", "arguments", "array", "ast", "async", "attribute", "attributes", "author", "base", "baseline", "before", "binding", "block", "body", "bool", "boolean", "branch", "browse", "buffer", "build", "bytecode", "bytes", "cache", "callback", "caller", "callers", "case", "categories", "category", "char", "character", "characters", "chars", "check", "child", "children", "class", "classes", "classname", "clean", "clear", "clone", "close", "code", "column", "command", "comment", "commit", "compile", "condition", "config", "constant", "content", "context", "copy", "count", "create", "current", "cursor", "data", "date", "debug", "declaration", "deep", "default", "define", "definition", "delete", "depth", "describe", "description", "destination", "detail", "diff", "dir", "directory", "doc", "docs", "document", "documentation", "dry", "duration", "edit", "editor", "element", "enable", "encoding", "end", "entry", "env", "environment", "error", "eval", "evaluate", "event", "exact", "example", "exception", "exclude", "exec", "execute", "expr", "expression", "extension", "field", "fields", "file", "filename", "filter", "find", "first", "fix", "flag", "flags", "force", "format", "frame", "from", "full", "function", "generate", "get", "glob", "global", "globals", "grep", "group", "handler", "hash", "header", "height", "help", "hierarchy", "host", "id", "ids", "ignore", "image", "impl", "implementation", "implementors", "import", "include", "index", "info", "inherited", "input", "insensitive", "inspect", "inst", "install", "instance", "instvar", "instvars", "int", "integer", "interface", "invoke", "item", "items", "json", "keep", "key", "keys", "keyword", "kind", "label", "language", "last", "left", "length", "level", "limit", "line", "lines", "lint", "list", "literal", "load", "local", "location", "log", "lookup", "main", "make", "map", "max", "member", "merge", "message", "messages", "meta", "metaclass", "metadata", "method", "methodname", "methods", "min", "mode", "model", "modify", "module", "monticello", "move", "name", "names", "namespace", "new", "next", "node", "num", "number", "object", "offset", "old", "only", "op", "open", "operation", "option", "options", "order", "origin", "output", "overwrite", "owner", "package", "packages", "page", "param", "params", "parent", "parse", "part", "path", "pattern", "payload", "pharo", "plain", "port", "position", "prefix", "preview", "previous", "print", "priority", "process", "project", "prompt", "properties", "property", "protocol", "pull", "push", "put", "query", "quiet", "range", "raw", "read", "reason", "receiver", "recompile", "recursive", "ref", "refactor", "reference", "references", "refresh", "regex", "reload", "remote", "remove", "rename", "replace", "replacement", "repo", "repository", "request", "required", "reset", "resolve", "response", "restart", "restore", "result", "results", "retrieve", "return", "revert", "revision", "right", "root", "row", "rule", "run", "save", "scope", "script", "search", "section", "select", "selector", "selectors", "self", "send", "sender", "senders", "sensitive", "server", "session", "set", "setting", "settings", "sha", "short", "show", "side", "signature", "silent", "size", "skip", "slot", "slots", "smalltalk", "snippet", "sort", "source", "spec", "src", "stack", "start", "state", "statement", "statements", "status", "step", "stop", "strict", "string", "style", "subclass", "subclasses", "suite", "super", "superclass", "symbol", "tag", "target", "task", "temp", "template", "temps", "test", "testcase", "tests", "text", "time", "timeout", "title", "to", "token", "tonel", "tool", "top", "trait", "traits", "tree", "type", "undo", "update", "uri", "url", "user", "validate", "value", "values", "var", "variable", "variables", "vars", "verbose", "verify", "version", "view", "visibility", "warning", "where", "whole", "width", "with", "word", "workspace", "write"],
    "MCP tools": ["class_create", "class_get", "class_remove", "class_search", "class_update", "critique_run", "debug_search", "debug_watch", "evaluate", "history_entry_apply", "history_entry_list", "history_entry_revert", "history_file_list", "history_lost_change_list", "history_lost_change_restore", "method_compile", "method_get", "method_reference_search", "method_remove", "method_restore", "method_rewrite", "method_search", "method_source_search", "method_update", "method_version_list", "package_search", "repository_attach", "repository_change_discard", "repository_change_list", "repository_commit", "repository_create", "repository_export", "repository_head_adopt", "repository_identity_verify", "repository_reload", "repository_search", "repository_update", "screen_capture", "screen_read", "test_coverage_run", "test_run", "tool_call", "tool_get", "tool_search"],
    "PLexus tools": ["image_create", "image_delete", "image_list", "image_start", "image_stop", "image_templates"],
    "pharo-image-fs tools": ["pifs_list", "pifs_start", "pifs_stop"],
    "project words": ["a", "aarch64", "absent", "absolute", "abstract", "accel", "accept", "accepted", "access", "accessing", "action", "actions", "actual", "add", "added", "adding", "addition", "additional", "adopt", "advertised", "advertising", "affected", "after", "again", "agent", "alive", "all", "allow", "already", "also", "ambiguous", "amd64", "an", "anchor", "and", "annotations", "announcement", "anonymous", "answer", "answered", "api", "apikey", "appdata", "applied", "apply", "applying", "approximate", "argument", "arguments", "arm64", "array", "as", "assets", "assigned", "assignment", "ast", "asts", "at", "attach", "attempted", "authorization", "auto", "average", "backend", "backends", "backslash", "badge", "base", "baseline", "basic", "batch", "before", "before12", "before13", "before14", "behavior", "binding", "bindings", "blank", "block", "blocked", "body", "book", "boolean", "bootstrap", "both", "bounds", "box", "branch", "breakpoint", "browse", "browser", "bucket", "budget", "buffering", "bug", "builder", "building", "but", "button", "by", "byte", "bytes", "cache", "call", "calls", "cancel", "candidate", "capabilities", "capture", "cascade", "case", "catalog", "category", "cause", "ch", "change", "changed", "changes", "check", "checking", "checkout", "checks", "children", "circling", "class", "classes", "classtrait", "classvar", "cleaning", "clear", "clearing", "client", "clock", "closing", "code", "collect", "collected", "collection", "collections", "column", "comma", "command", "commands", "comment", "comments", "commit", "committed", "common", "commondir", "comparing", "compatibility", "compilation", "compile", "compiled", "complete", "completed", "completing", "completion", "completions", "composite", "composition", "concatenation", "conditional", "config", "configuration", "configured", "configuring", "confirm", "conflict", "connection", "content", "contents", "context", "control", "conversion", "converting", "copy", "copying", "count", "counter", "counts", "coverage", "covered", "crash", "create", "created", "credential", "criteria", "critique", "critiques", "critiquing", "current", "daemon", "darwin", "dashboard", "data", "database", "dead", "debug", "debugger", "debuggers", "debugging", "deep", "default", "defaults", "deferring", "defined", "defines", "definition", "delete", "deleted", "delta", "deny", "dependent", "depth", "described", "description", "destructive", "detached", "detail", "details", "detect", "diagnostics", "dictionary", "diff", "direct", "direction", "directory", "dirty", "disable", "disabled", "discard", "discarded", "discarding", "discoverable", "discovered", "discovers", "discovery", "dispatch", "dispatched", "dispatching", "display", "displaying", "do", "document", "does", "domain", "down", "dt", "duration", "during", "dynamic", "earlier", "edit", "element", "elements", "emptiness", "empty", "enable", "enabled", "ended", "ending", "endings", "endpoint", "entity", "entries", "entry", "enum", "enumerating", "environment", "ep", "epicea", "equals", "equivalent", "error", "errored", "errors", "es", "evaluate", "evaluating", "evaluation", "event", "example", "exceeded", "exception", "excluded", "excludes", "execute", "executed", "executing", "execution", "exists", "exit", "expectation", "expected", "explanation", "explicit", "export", "exporter", "exporting", "exposure", "expression", "extension", "extra", "failed", "failure", "failures", "false", "fetch", "field", "fields", "file", "files", "filesystem", "filetree", "filter", "filtered", "finished", "first", "fixable", "fixed", "flight", "flush", "folder", "for", "force", "format", "formats", "formatting", "found", "frame", "frames", "from", "from12", "from13", "from14", "fs", "fully", "get", "git", "glamorous", "global", "globals", "go", "got", "green", "group", "growth", "guard", "half", "halt", "handled", "handler", "has", "head", "header", "headers", "headless", "height", "held", "help", "hierarchy", "hint", "histogram", "history", "hit", "hits", "holders", "holds", "home", "how", "http", "ice", "iceberg", "icon", "icons", "id", "ide", "idempotent", "identity", "ies", "if", "ignore", "image", "immediate", "impact", "implemented", "implementor", "implementors", "in", "include", "included", "includes", "incomplete", "index", "indexes", "info", "inherited", "initialization", "initialize", "input", "inspect", "inst", "installation", "installed", "installing", "instance", "instructions", "instrument", "integer", "interactive", "interface", "intermediate", "interrupted", "interruption", "interval", "into", "introspection", "invalid", "is", "issues", "it", "items", "its", "itself", "jrpc", "jrpchttp", "json", "jsonrpc", "keep", "kernel", "key", "keymap", "keys", "keyword", "keywords", "kind", "kinds", "knows", "label", "large", "last", "layout", "least", "left", "length", "less", "lhs", "lift", "limit", "line", "link", "lint", "linux", "list", "listed", "listen", "listener", "load", "loaded", "loader", "loading", "local", "localhost", "location", "locations", "lock", "log", "logger", "logging", "logs", "lookup", "lost", "machine", "major", "manager", "managing", "manifest", "match", "matches", "matching", "max", "maximum", "may", "mc", "mcp", "mcphttp", "mcpide", "mcpjson", "mcpui", "memory", "merge", "merging", "message", "messages", "meta", "metacello", "metaclass", "metadata", "meter", "method", "methods", "metrics", "millisecond", "milliseconds", "mime", "min", "minimum", "minor", "minus", "mismatch", "mismatches", "missing", "mkdir", "mode", "model", "modification", "modified", "monticello", "more", "morph", "morphic", "mount", "move", "moving", "ms", "multi", "mutation", "mutex", "name", "named", "names", "nested", "new", "newest", "next", "nil", "no", "node", "nodes", "none", "noop", "not", "note", "nothing", "notice", "notices", "notification", "notifications", "null", "number", "numbers", "object", "objects", "observability", "observe", "obsolete", "oc", "of", "off", "offset", "ok", "old", "ombu", "on", "one", "only", "open", "operation", "optimized", "option", "options", "or", "organization", "origin", "os", "otel", "other", "otlp", "out", "outcome", "outcomes", "outlier", "output", "over", "overriding", "own", "owner", "ownership", "package", "packages", "page", "pagination", "pairs", "parameters", "parametrized", "params", "parent", "parse", "parser", "parsing", "partial", "partially", "passed", "passes", "passphrase", "password", "past", "path", "paths", "pattern", "patterns", "paused", "pending", "percent", "percentage", "permutation", "pharo", "phrasing", "pid", "pifs", "ping", "pipe", "planning", "play", "playground", "plus", "point", "poller", "pool", "pooldictionary", "pools", "port", "position", "positions", "post", "pre14", "preamble", "prefixes", "present", "presenter", "preview", "previous", "print", "printing", "prior", "private", "probe", "proceed", "process", "processor", "progress", "project", "projection", "projections", "projects", "prompt", "prompts", "properties", "protected", "protocol", "provider", "providers", "public", "publish", "pull", "pulled", "push", "pushed", "quality", "queries", "query", "querying", "question", "queue", "rb", "re", "read", "readable", "reading", "reads", "reason", "recategorize", "receiver", "recent", "record", "recorded", "recorder", "recording", "records", "recover", "red", "redundant", "ref", "refactor", "refactoring", "refer", "reference", "references", "reflectivity", "reformatted", "refresh", "regex", "registered", "registers", "registries", "registry", "reload", "remaining", "remote", "remotes", "removal", "removals", "remove", "removed", "rename", "renamed", "rendered", "rendering", "renraku", "repair", "reparent", "reparented", "replace", "replaced", "replacement", "repo", "reporting", "repositories", "repository", "request", "requested", "requestor", "requests", "required", "requires", "resolved", "resolving", "resource", "resources", "responds", "response", "restart", "restore", "restored", "restoring", "result", "results", "resume", "retired", "return", "returned", "rev", "revert", "reverted", "review", "rewrite", "rewriter", "rewriting", "rhs", "right", "rmdir", "role", "root", "row", "rpc", "rule", "rules", "run", "runner", "running", "runtime", "s", "safe", "save", "saved", "scale", "schema", "scope", "score", "screen", "screenshot", "script", "sdk", "search", "second", "seconds", "secret", "select", "selected", "selection", "selections", "selector", "selectors", "self", "send", "sender", "senders", "sends", "sent", "sequence", "sequenced", "server", "servers", "ses", "session", "sessions", "set", "settings", "settle", "settling", "several", "severity", "sh", "shadow", "shape", "shared", "show", "side", "signaler", "signaling", "signature", "size", "sizes", "skipped", "slash", "slot", "slots", "small", "smalltalk", "snapshot", "socket", "sorted", "source", "sources", "sp", "spans", "spec", "specs", "src", "ss", "stack", "stale", "stamp", "star", "start", "started", "starting", "stat", "state", "statement", "static", "stats", "status", "still", "stop", "stopped", "stopping", "stream", "streaming", "streams", "string", "structure", "structured", "style", "subclass", "subclasses", "subdirectory", "subject", "subscribe", "subscription", "substring", "success", "suggested", "suggester", "suggesting", "suggestion", "suggestions", "suite", "summary", "sunit", "super", "superclass", "superclasses", "superseded", "supported", "switch", "symbol", "symbolic", "symlink", "syntax", "t", "table", "tag", "tags", "target", "targets", "tasks", "tcp", "tear", "telemetry", "template", "templates", "temporary", "tense", "terminate", "test", "testing", "tests", "text", "that", "them", "theme", "then", "they", "thiner", "this", "threaded", "through", "tilde", "time", "timed", "timeout", "timestamp", "title", "tmcp", "to", "token", "tokens", "tonel", "too", "tool", "tools", "total", "trace", "tracer", "traces", "trait", "traits", "transcript", "transport", "trash", "tree", "trigger", "true", "truncated", "ttl", "type", "ui", "unavailable", "unchanged", "uncommitted", "uncovered", "undeclared", "understood", "undo", "unknown", "unlisted", "unloaded", "unmarked", "unmount", "unpackaged", "unreadable", "unrun", "unsaved", "unsupported", "unwinding", "up", "update", "updated", "updates", "updating", "upside", "upstream", "uri", "url", "usage", "use", "user", "users", "uses", "utilities", "v", "validating", "validator", "value", "values", "variable", "variables", "vars", "vary", "verb", "verify", "version", "versions", "via", "violation", "violations", "virtual", "visible", "visitor", "warning", "warnings", "was", "wat", "watch", "watched", "watching", "weak", "website", "width", "window", "windows", "with", "without", "word", "working", "workspace", "world", "writable", "write", "writer", "writes", "writing", "written", "x", "x86", "xdg", "y", "yaml", "yes", "z", "zn"],
    "MCP exception classes": ["CodeError", "CompileSyntaxError", "EvaluationRuntimeError", "EvaluationTimedOut", "ExecutionError", "FileDoesNotExistException", "FileException", "FileSystemError", "IceError", "JRPCError", "MCMergeOrLoadWarning", "MCPCommandError", "MCPHeaderMismatch", "MCPInvalidToolInput", "MCPMissingPromptArgument", "MCPResourceNotFound", "MCPSyntaxError", "MCPToolDefaultActionNotification", "MCPToolNestedNotification", "MCPToolRefusedNotification", "MCPUnknownCompletionReference", "MCPUnknownPrompt", "MCPUnsupportedProtocolVersion", "OCCodeError", "OCCompilationError", "OCErrorNotice", "OCNotice", "OCSemanticWarning", "OCShadowVariableWarning", "OCStoreIntoReadOnlyVariableError", "OCSyntaxErrorNotice", "OCUndeclaredVariableNotice", "OCUndeclaredVariableWarning", "OupsNullException", "PCRE2CompileError", "PullUpSlotRefactoringError", "PullUpSlotRefactoringWarning", "RBBreakingChangeChecksFailedWarning", "RBRefactoringError", "RBRefactoringFailure", "RBRefactoringWarning", "RBSyntaxErrorNotice", "RefactoringError", "RefactoringWarning", "RegexSyntaxError", "RemoveSlotRefactoringError", "RemoveSlotRefactoringWarning", "RuntimeSyntaxError", "SocketError", "SyntaxError", "SyntaxErrorNotification", "TestFailure", "TonelParseError", "ToolError", "ToolExecutionError", "UnhandledError", "ZnCharacterEncodingError"]
  },
  "resource": {
    "service.name": {
      "about": "Which tool sent the span.",
      "type": "string",
      "values": ["plexus", "pharo-mcp"]
    },
    "service.version": {
      "about": "That tool's version.",
      "type": "string",
      "pattern": "version"
    },
    "os.type": {
      "about": "The OS family.",
      "type": "string",
      "values": "OS types"
    },
    "process.runtime.name": {
      "about": "nodejs or pharo.",
      "type": "string",
      "values": ["nodejs", "pharo"]
    },
    "process.runtime.version": {
      "about": "Node's major version, or Pharo's major and minor.",
      "type": "string",
      "extract": {
        "plexus": "^v?([0-9]{1,4})(?:\\.[\\s\\S]*)?$",
        "pharo-mcp": "^v?([0-9]{1,4}\\.[0-9]{1,4})(?:[.+-][\\s\\S]*)?$"
      },
      "pattern": "version"
    },
    "deployment.environment.name": {
      "about": "field for participants, eval for our own evaluation runs, preview while previewing, check for npm run check-deployment.",
      "type": "string",
      "values": ["field", "eval", "preview", "check"]
    },
    "pharo_agent_evals.variant": {
      "about": "Which variant of an evaluation run sent the span: the build under test, which may report a released version. Kept only for eval.",
      "type": "string",
      "pattern": "variant",
      "when": {
        "deployment.environment.name": "eval"
      }
    }
  },
  "span": {
    "session.id": {
      "about": "Groups the calls of one working session. PLexus makes it at random, or MCP when the call came without one, and either starts another after 30 minutes without a call; it is replaced by its keyed hash before it leaves your machine.",
      "type": "string",
      "pattern": "text",
      "hash": "session"
    },
    "mcp.method.name": {
      "about": "The MCP method.",
      "type": "string",
      "values": ["tools/call", "tools/list"]
    },
    "mcp.protocol.version": {
      "about": "The MCP protocol version the client's request declared, a date.",
      "from": ["pharo-mcp"],
      "type": "string",
      "pattern": "date"
    },
    "gen_ai.tool.name": {
      "about": "The tool's name: one a project publishes, else a name the agent asked for that no tool has, or MCP's own, when made of words of the vocabulary.",
      "type": "string",
      "pattern": "identifier",
      "otherwise": "_OTHER",
      "name": true,
      "nameOther": "_OTHER",
      "tool": true
    },
    "error.type": {
      "about": "How a call failed: tool_error, a JSON-RPC or HTTP code, how a connection failed, a PLexus error code, or an exception class of Pharo, MCP or Node.",
      "type": "string",
      "values": ["call failures", "PLexus error codes", "exception classes", "MCP exception classes"],
      "pattern": "code",
      "otherwise": "_OTHER"
    },
    "plexus.client.name": {
      "about": "The agent host, as it introduces itself to PLexus's server, when it is one the allowlist knows.",
      "from": ["plexus"],
      "type": "string",
      "values": "agent hosts",
      "otherwise": "_OTHER"
    },
    "plexus.client.version": {
      "about": "The agent host's version, major and minor, beside a name the allowlist knows.",
      "from": ["plexus"],
      "beside": "plexus.client.name",
      "type": "string",
      "extract": "^v?([0-9]{1,4}\\.[0-9]{1,4})(?:[.+-][\\s\\S]*)?$",
      "pattern": "version"
    },
    "plexus.call.index": {
      "about": "Where the call comes in its session: 1 for the first.",
      "from": ["plexus"],
      "type": "int",
      "min": 1
    },
    "plexus.call.forwarded": {
      "about": "Whether PLexus passed the call on to an image, which then names the tool.",
      "from": ["plexus"],
      "type": "bool"
    },
    "plexus.argument.names": {
      "about": "The names of the arguments a call to one of PLexus's own tools gave, never their values.",
      "from": ["plexus"],
      "type": "string[]",
      "pattern": "identifier",
      "words": "name",
      "max": 32,
      "name": true
    },
    "plexus.argument.unknown_names": {
      "about": "Argument names a call gave that PLexus's own tool does not take.",
      "from": ["plexus"],
      "type": "string[]",
      "pattern": "identifier",
      "words": "name",
      "max": 32,
      "name": true
    },
    "plexus.error.code": {
      "about": "Why PLexus refused a call before any image saw it.",
      "from": ["plexus"],
      "type": "string",
      "values": "PLexus error codes",
      "otherwise": "_OTHER"
    },
    "plexus.image.save": {
      "about": "Whether stopping an image saved it.",
      "from": ["plexus"],
      "type": "bool"
    },
    "pharo.mcp.tool.origin": {
      "about": "mcp for one of MCP's own tools, other for a tool another package added, unknown for a name no tool has. Names are kept only for mcp and unknown.",
      "from": ["pharo-mcp"],
      "type": "string",
      "values": ["mcp", "other", "unknown"],
      "otherwise": "other",
      "default": "other"
    },
    "pharo.mcp.dispatch_path": {
      "about": "How the image dispatched the request.",
      "from": ["pharo-mcp"],
      "type": "string",
      "values": ["direct", "via_tool_call"]
    },
    "pharo.mcp.client.name": {
      "about": "The agent host, as it introduces itself to MCP's server, when it is one the allowlist knows: under PLexus, PLexus itself.",
      "from": ["pharo-mcp"],
      "type": "string",
      "values": "agent hosts",
      "otherwise": "_OTHER"
    },
    "pharo.mcp.client.version": {
      "about": "Its version, major and minor, beside a name the allowlist knows.",
      "from": ["pharo-mcp"],
      "beside": "pharo.mcp.client.name",
      "type": "string",
      "extract": "^v?([0-9]{1,4}\\.[0-9]{1,4})(?:[.+-][\\s\\S]*)?$",
      "pattern": "version"
    },
    "pharo.mcp.argument.names": {
      "about": "The names of the arguments the tool declares that the call gave, never their values.",
      "from": ["pharo-mcp"],
      "type": "string[]",
      "pattern": "identifier",
      "words": "name",
      "max": 32,
      "name": true
    },
    "pharo.mcp.argument.unknown_names": {
      "about": "Argument names the call gave that the tool does not declare.",
      "from": ["pharo-mcp"],
      "type": "string[]",
      "pattern": "identifier",
      "words": "name",
      "max": 32,
      "name": true
    },
    "pharo.mcp.argument.options": {
      "about": "The options the call chose, as the evaluations count them: a property, a value of an enumeration, or a list given for several targets.",
      "from": ["pharo-mcp"],
      "type": "string[]",
      "pattern": "option",
      "max": 32,
      "name": true
    },
    "pharo.mcp.input.bytes": {
      "about": "The size of the arguments.",
      "from": ["pharo-mcp"],
      "type": "int",
      "buckets": [0,1,2,4,8,16,32,64,128,256,512,1024,2048,4096,8192,16384,32768,65536,131072,262144,524288,1048576,2097152,4194304,8388608,16777216]
    },
    "pharo.mcp.output.bytes": {
      "about": "The size of the answer.",
      "from": ["pharo-mcp"],
      "type": "int",
      "buckets": [0,1,2,4,8,16,32,64,128,256,512,1024,2048,4096,8192,16384,32768,65536,131072,262144,524288,1048576,2097152,4194304,8388608,16777216]
    },
    "pharo.mcp.output_budget.exceeded": {
      "about": "Whether the answer was cut to fit the output budget, which its size, kept in buckets, does not say.",
      "from": ["pharo-mcp"],
      "type": "bool"
    },
    "pharo.mcp.result.count": {
      "about": "How many results a search answered.",
      "from": ["pharo-mcp"],
      "type": "int",
      "buckets": [0,1,2,6,21,101]
    },
    "pharo.mcp.result.more": {
      "about": "Whether there were more results than answered.",
      "from": ["pharo-mcp"],
      "type": "bool"
    },
    "pharo.mcp.test.outcome": {
      "about": "How a test run ended.",
      "from": ["pharo-mcp"],
      "type": "string",
      "values": ["passed", "failed", "errored", "none"]
    },
    "pharo.mcp.test.count": {
      "about": "How many tests ran.",
      "from": ["pharo-mcp"],
      "type": "int",
      "buckets": [0,1,2,6,21,101]
    },
    "pharo.mcp.tool.refs": {
      "about": "The tools a discovery call (tool_search, tool_get) named.",
      "from": ["pharo-mcp"],
      "type": "string[]",
      "pattern": "identifier",
      "published": true,
      "otherwise": "_OTHER",
      "max": 16,
      "name": true
    },
    "pharo.mcp.error.kind": {
      "about": "The kind of error MCP reported.",
      "from": ["pharo-mcp"],
      "type": "string",
      "values": ["input_schema", "domain", "tool_result", "json_rpc", "exception"]
    },
    "pharo.mcp.error.code": {
      "about": "The error code MCP gave its answer.",
      "from": ["pharo-mcp"],
      "type": "string",
      "pattern": "identifier",
      "words": "name",
      "otherwise": "_OTHER",
      "own": true
    },
    "pharo.mcp.error.schema.keywords": {
      "about": "Which schema rules they broke.",
      "from": ["pharo-mcp"],
      "type": "string[]",
      "values": "schema keywords",
      "max": 8
    },
    "pharo.mcp.error.schema.paths": {
      "about": "Where in the tool's input they broke them.",
      "from": ["pharo-mcp"],
      "type": "string[]",
      "pattern": "JSON pointer",
      "words": "pointer",
      "max": 8,
      "name": true
    },
    "pharo.mcp.exception.type": {
      "about": "The nearest Pharo or MCP class of an exception.",
      "from": ["pharo-mcp"],
      "type": "string",
      "values": ["exception classes", "MCP exception classes"],
      "otherwise": "_OTHER"
    },
    "span.duration_ms": {
      "about": "How long the span took, in whole milliseconds, kept since its times are not.",
      "type": "double",
      "min": 0,
      "whole": true
    },
    "pharo_agent_telemetry.session.offset_ms": {
      "about": "When the span started, in milliseconds after the first span of its session the agent on your machine saw (negative when it saw a later one first): the order of a session's calls, never a time of day.",
      "type": "int"
    }
  },
  "blockedValues": {
    "a home directory path": "(?is)^.*(/Users/|/home/|[A-Z]:\\\\Users\\\\).*$",
    "an email address": "(?s)^.*[A-Za-z0-9._%+-]@[A-Za-z0-9.-]+\\.[A-Za-z]{2}.*$",
    "an IPv4 address": "(?s)^.*\\b(?:[0-9]{1,3}\\.){3}[0-9]{1,3}\\b.*$",
    "an IPv6 address": "(?is)^.*(?:::|\\b[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){7}\\b).*$"
  },
  "releases": {
    "MCP": "v4.2.1-10-g04d8445 + v4.2.1-5-g6208aed + v4.2.1-3-ge601136",
    "PLexus": "v0.20.0-4-g6075384",
    "pharo-image-fs": "v0.13.0-5-g72c0abf"
  }
};
const kindNames = ["SPAN_KIND_UNSPECIFIED", "SPAN_KIND_INTERNAL", "SPAN_KIND_SERVER", "SPAN_KIND_CLIENT", "SPAN_KIND_PRODUCER", "SPAN_KIND_CONSUMER"];
const statusNames = ["STATUS_CODE_UNSET", "STATUS_CODE_OK", "STATUS_CODE_ERROR"];
const clientKind = 3;

/** The kinds a service may require, by the name the allowlist gives them. */
const kinds = { internal: 1, server: 2, client: 3, producer: 4, consumer: 5 };

/** A week in nanoseconds, and a Monday at midnight UTC: times are kept to the week they fall in. */
const week = 604_800_000_000_000n;
const monday = 345_600_000_000_000n;

/** 2^63: no int64 reaches it, nor a time in nanoseconds the collector and Elasticsearch read (2262). */
const int64 = 9_223_372_036_854_775_808n;

/** The longest duration in milliseconds a span's int64 times can give, rounded up: a double past it is no duration. */
const longestMilliseconds = 9_300_000_000_000;

/** What a value that holds an address, a path or an email becomes before its shape is checked. */
const masked = "****";

/** The operation a span named `tools/call <tool>` performed; the tool after it is the span's gen_ai.tool.name. */
const toolCall = "tools/call";

/** The attributes the rules read beyond their own value: the tool, whose it is, and the session. */
const toolKey = "gen_ai.tool.name";
const originKey = "pharo.mcp.tool.origin";
const forwardedKey = "plexus.call.forwarded";
const sessionKey = "session.id";

/** The attribute the agent adds: where a span comes in its session, which times kept to the week lose. */
const offsetKey = "pharo_agent_telemetry.session.offset_ms";

/**
 * A name as the vocabulary check reads it: each camelCase word boundary
 * (`className`, `HTTPServer`) made a `_`, in lower case. Written as the two
 * replacements and the case change the collector's OTTL makes.
 */
const wordBoundaries = [["([A-Z])([A-Z][a-z])", "$1_$2"], ["([a-z0-9])([A-Z])", "$1_$2"]];

/** A name with its word boundaries made `_`, in lower case. */
function wordForm(name) {
  return wordBoundaries.reduce((text, [pattern, replacement]) => text.replace(new RegExp(pattern, "g"), replacement), name).toLowerCase();
}

/** The words of a name, as the vocabulary check reads them. */
function nameWords(name) {
  return wordForm(name).split(/[_-]/);
}

/** A pattern written for Go's RE2 as a JavaScript RegExp: a leading `(?flags)` becomes the RegExp's flags. */
function regExp(pattern) {
  const flags = /^\(\?([a-z]+)\)/.exec(pattern);
  return new RegExp(flags ? pattern.slice(flags[0].length) : pattern, flags ? flags[1] : "");
}

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const unanchored = (pattern) => pattern.replace(/^\^/, "").replace(/\$$/, "");

/** An alternation of words that shares their prefixes, a pattern both RE2 and JavaScript read: `(?:class(?:es)?|...)`. */
function alternation(words) {
  const trie = new Map();
  for (const word of words) {
    let node = trie;
    for (const character of word) {
      if (!node.has(character)) node.set(character, new Map());
      node = node.get(character);
    }
    node.set("", new Map());
  }
  const emit = (node) => {
    const branches = [...node].filter(([character]) => character !== "").sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([character, child]) => `${escaped(character)}${emit(child)}`);
    if (branches.length === 0) return "";
    const group = branches.length === 1 && !node.has("") ? branches[0] : `(?:${branches.join("|")})`;
    return node.has("") ? `${group}?` : group;
  };
  return `(?:${emit(trie)})`;
}

/**
 * The patterns a value's word form must match to be made of the
 * vocabulary's words, the same for both filters: a name (`class_name`, from
 * `className`), as itself or as the elements of a list, written as the JSON
 * text OTTL's String() makes of a list of strings (`["class_name","side"]`);
 * or a list of JSON pointers of names and indices (`/scope/classes/0`).
 */
function wordPatterns(words) {
  const word = alternation([...new Set(words)].sort());
  const end = '"[,\\]]';
  const list = (element) => `^\\[(?:\\]|(?:${element})+)$`;
  return {
    name: { scalar: `^(?:${word}[_-])*${word}$`, list: list(`"(?:${word}(?:[_-]|${end}))+`) },
    // An index as MCP writes one: no leading zero, which would let any digits through.
    pointer: { list: list(`"(?:${end}|/(?:(?:${word}|0|[1-9][0-9]{0,2})(?:[_/-]|${end}))+)`) },
  };
}

/**
 * The allowlist, made ready to apply: for each attribute, the one pattern
 * (RE2 and JavaScript alike) its value, or each element of its list, must
 * match, and what else the allowlist says of it.
 *
 * @param {any} allowlist collector/allowlist.json with the catalog's sets
 */
function compile(allowlist) {
  const sets = allowlist.sets ?? {};
  const named = allowlist.patterns ?? {};
  const members = (names) => [].concat(names ?? []).flatMap((name) => {
    if (!(name in sets)) throw new Error(`No set named ${name}.`);
    return sets[name];
  });
  const words = wordPatterns(members(allowlist.vocabulary).flatMap((each) => nameWords(each)).filter((word) => word.length > 0));
  const publishedNames = new Set(members(allowlist.published));
  const publishedPattern = `^(?:${[...publishedNames].sort().map(escaped).join("|")})$`;
  const source = (spec) => {
    const parts = [];
    for (const value of [].concat(spec.values ?? [])) for (const each of sets[value] ?? [value]) parts.push(escaped(String(each)));
    if (spec.pattern) parts.push(unanchored(named[spec.pattern] ?? spec.pattern));
    return parts.length > 0 ? `^(?:${parts.join("|")})$` : undefined;
  };
  const attributes = (specs) => Object.entries(specs).map(([key, spec]) => {
    const pattern = source(spec);
    const extract = typeof spec.extract === "string" ? { "*": spec.extract } : spec.extract;
    return {
      key,
      ...spec,
      from: spec.from,
      pattern,
      test: pattern === undefined ? undefined : regExp(pattern),
      extract,
      extractTests: extract && Object.fromEntries(Object.entries(extract).map(([service, each]) => [service, regExp(each)])),
      wordsPattern: spec.words && words[spec.words][spec.type === "string[]" ? "list" : "scalar"],
      wordsTest: spec.words && regExp(words[spec.words][spec.type === "string[]" ? "list" : "scalar"]),
    };
  });
  const services = Object.fromEntries(Object.entries(allowlist.services).map(([service, { scope, spans, tools, kinds: required, requires }]) => {
    const names = spans.map((name) => (name === toolCall ? `${escaped(name)}(?: [\\s\\S]*)?` : escaped(name)));
    const namePattern = `^(?:${names.join("|")})$`;
    const own = tools === undefined ? undefined : members(tools);
    return [service, {
      scope,
      namePattern,
      names: regExp(namePattern),
      tools: own,
      toolPattern: own && `^(?:${own.map(escaped).join("|")})$`,
      ownTools: own && new Set(own),
      kinds: required?.map((name) => kinds[name]),
      requires: requires ?? [],
    }];
  }));
  const blocked = Object.entries(allowlist.blockedValues ?? {}).map(([what, pattern]) => ({ what, pattern, test: regExp(pattern) }));
  const versionPattern = named.version;
  return {
    services,
    resource: attributes(allowlist.resource),
    span: attributes(allowlist.span),
    blocked,
    versionPattern,
    version: regExp(versionPattern),
    published: publishedNames,
    publishedPattern,
    words,
    nameWords: regExp(words.name.scalar),
  };
}

/** The keyed hash ids are replaced by: equal inputs stay equal, and nothing without the key joins them to anything. */
function keyedHash(key) {
  return (tag, value, length = 32) => createHash("sha256").update(`${key}:${tag}:${value}`).digest("hex").slice(0, length);
}

// OTLP JSON values, read into typed values and written back.

/** @returns {{ type: "string" | "int" | "double" | "bool" | "list" | "other", value?: any }} */
function read(value) {
  if (value === null || typeof value !== "object") return { type: "other" };
  if (typeof value.stringValue === "string") return { type: "string", value: value.stringValue };
  if ("intValue" in value) {
    const int = value.intValue;
    // An int64, as the collector reads one: a number past 2^53 has lost its digits already.
    if (typeof int === "number" && Number.isSafeInteger(int)) return { type: "int", value: BigInt(int) };
    if (typeof int === "string" && /^-?[0-9]{1,19}$/.test(int) && BigInt(int) >= -int64 && BigInt(int) < int64) return { type: "int", value: BigInt(int) };
    return { type: "other" };
  }
  if (typeof value.doubleValue === "number") return { type: "double", value: value.doubleValue };
  if (typeof value.boolValue === "boolean") return { type: "bool", value: value.boolValue };
  if (value.arrayValue && typeof value.arrayValue === "object") {
    const values = value.arrayValue.values ?? [];
    return Array.isArray(values) ? { type: "list", value: values.map(read) } : { type: "other" };
  }
  return { type: "other" };
}

function write({ type, value }) {
  switch (type) {
    case "string": return { stringValue: value };
    case "int": return { intValue: String(value) };
    case "double": return { doubleValue: value };
    case "bool": return { boolValue: value };
    default: return { arrayValue: value.length > 0 ? { values: value.map(write) } : {} };
  }
}

/**
 * One attribute as the rules keep it, or undefined when they drop it.
 *
 * @param {ReturnType<typeof compile>} rules
 * @param {any} spec the attribute's compiled entry
 * @param {ReturnType<typeof read>} value
 * @param {string} service
 * @param {{ hash?: (tag: string, value: string, length?: number) => string, week: bigint, why: (reason: string) => void }} options
 */
function keep(rules, spec, value, service, { hash, week: weekStart, why }) {
  if (spec.from && !spec.from.includes(service)) return why(`is not sent by ${service}`);
  let { type, value: v } = value;
  if (spec.type === "double" && type === "int") {
    type = "double";
    v = Number(v);
  }
  const wanted = spec.type === "string[]" ? "list" : spec.type;
  if (type !== wanted) return why(`is not a ${spec.type}`);
  let hit;
  if (!spec.hash && type === "string") {
    hit = rules.blocked.find((each) => each.test.test(v));
    if (hit) v = masked;
  }
  if (spec.extract) {
    const pattern = spec.extractTests[service] ?? spec.extractTests["*"];
    if (pattern === undefined) return why(`is not kept from ${service}`);
    v = v.replace(pattern, "$1");
  }
  if (type === "list") {
    const hit = v.find((each) => each.type === "string" && rules.blocked.some((blocked) => blocked.test.test(each.value)));
    if (hit) return why(`holds ${rules.blocked.find((blocked) => blocked.test.test(hit.value)).what}`);
  }
  if (type === "string" && spec.test && !spec.test.test(v)) {
    if (spec.otherwise === undefined) return why(hit ? `holds ${hit.what}` : "does not have its shape");
    v = spec.otherwise;
  }
  if (type === "string" && spec.wordsTest && !spec.wordsTest.test(wordForm(v))) {
    if (spec.otherwise === undefined) return why("holds a word the vocabulary does not have");
    v = spec.otherwise;
  }
  if (type === "int") {
    if (spec.min !== undefined && v < BigInt(spec.min)) return why(`is under ${spec.min}`);
    if (spec.buckets) {
      if (v < BigInt(spec.buckets[0])) return why(`is under ${spec.buckets[0]}`);
      v = BigInt([...spec.buckets].reverse().find((bound) => v >= BigInt(bound)));
    }
  }
  if (type === "double" && spec.min !== undefined && !(v >= spec.min)) return why(`is under ${spec.min}`);
  if (type === "double" && spec.whole) {
    if (!(v < longestMilliseconds)) return why("is longer than any span");
    v = Math.trunc(v);
  }
  if (type === "list") {
    if (spec.max !== undefined && v.length > spec.max) return why(`holds more than ${spec.max} elements`);
    if (v.some((each) => each.type !== "string")) return why("holds an element that is not a string");
    if (spec.published) {
      v = v.map((each) => (rules.published.has(each.value) ? each : { type: "string", value: spec.otherwise }));
    } else {
      if (spec.test && v.some((each) => !spec.test.test(each.value))) return why("holds an element without its shape");
      // The list as the JSON text the collector's String() makes of it, so both filters read the same text.
      if (spec.wordsTest && !spec.wordsTest.test(wordForm(JSON.stringify(v.map((each) => each.value))))) return why("holds a word the vocabulary does not have");
    }
  }
  if (spec.hash && hash) v = hash(spec.hash, `${weekStart}:${v}`);
  return { type, value: v };
}

/**
 * The attributes the rules keep, in their order, or undefined when two share
 * a key: a key given twice is how a value would slip past a rule that reads
 * only the first, so such a span is dropped whole.
 */
function keepAll(rules, specs, attributes, service, options, where) {
  if (attributes !== undefined && !Array.isArray(attributes)) return undefined;
  const seen = new Set();
  const kept = new Map();
  for (const entry of attributes ?? []) {
    if (entry === null || typeof entry !== "object" || typeof entry.key !== "string") return undefined;
    if (seen.has(entry.key)) return undefined;
    seen.add(entry.key);
    const spec = specs.find((each) => each.key === entry.key);
    const why = (reason) => { options.report(`${where}: ${entry.key} ${reason}`); return undefined; };
    if (spec === undefined) {
      why("is not in the allowlist");
      continue;
    }
    const value = keep(rules, spec, read(entry.value), service, { ...options, why });
    if (value !== undefined) kept.set(entry.key, value);
  }
  for (const spec of specs) {
    if (spec.default !== undefined && !kept.has(spec.key) && (!spec.from || spec.from.includes(service))) kept.set(spec.key, { type: "string", value: spec.default });
  }
  for (const spec of specs) {
    if (!spec.beside || !kept.has(spec.key)) continue;
    const other = specs.find((each) => each.key === spec.beside);
    const value = kept.get(spec.beside)?.value;
    if (value === undefined || value === other?.otherwise) {
      kept.delete(spec.key);
      options.report(`${where}: ${spec.key} is kept only beside a ${spec.beside} the allowlist knows`);
    }
  }
  for (const spec of specs) {
    if (!spec.when || !kept.has(spec.key)) continue;
    if (Object.entries(spec.when).some(([key, value]) => kept.get(key)?.value !== value)) {
      kept.delete(spec.key);
      options.report(`${where}: ${spec.key} is kept only beside ${Object.entries(spec.when).map(([key, value]) => `${key} ${value}`).join(", ")}`);
    }
  }
  return kept;
}

const hex = (text, length) => typeof text === "string" && new RegExp(`^[0-9a-fA-F]{${length}}$`).test(text) && !/^0+$/.test(text);

function nanos(value) {
  if (typeof value === "string" && /^[0-9]{1,20}$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  return value === undefined ? 0n : undefined;
}

function enumValue(value, names) {
  if (value === undefined) return 0;
  if (typeof value === "string") return names.indexOf(value);
  return Number.isInteger(value) ? value : -1;
}

/** The Monday at midnight UTC of the week a time falls in. */
const weekOf = (start) => start - ((((start - monday) % week) + week) % week);

/**
 * The tool's name, whose it is, and the names that go with it, as the rules
 * keep them: names only of tools a project publishes, or that MCP answered
 * for and that are made of the vocabulary's words.
 */
function keepNames(rules, attributes, service, kind) {
  const names = rules.span.filter((spec) => spec.name);
  const tool = attributes.get(toolKey);
  const published = tool !== undefined && rules.published.has(tool.value);
  if (service === "pharo-mcp") {
    const origin = attributes.get(originKey)?.value;
    if (tool !== undefined && !published && (origin === "other" || !rules.nameWords.test(wordForm(tool.value)))) attributes.set(toolKey, { type: "string", value: "_OTHER" });
    if (origin === "other" && !published) {
      for (const spec of rules.span.filter((each) => each.own)) attributes.delete(spec.key);
      for (const spec of names) {
        if (!attributes.has(spec.key)) continue;
        if (spec.nameOther === undefined) attributes.delete(spec.key);
        else attributes.set(spec.key, { type: "string", value: spec.nameOther });
      }
    }
  }
  const { ownTools } = rules.services[service];
  if (ownTools) {
    if (tool !== undefined && !published) attributes.set(toolKey, { type: "string", value: "_OTHER" });
    const own = tool !== undefined && ownTools.has(tool.value);
    const forwarded = attributes.get(forwardedKey)?.value === true || kind === clientKind || !own;
    if (forwarded) for (const spec of names) if (!spec.tool) attributes.delete(spec.key);
  }
}

/**
 * One span as the rules keep it, or undefined when they drop it.
 *
 * @param {ReturnType<typeof compile>} rules
 */
function keepSpan(rules, span, service, options) {
  const where = `span ${typeof span?.name === "string" ? span.name : "?"}`;
  const drop = (reason) => { options.report(`${where}: ${reason}`); return undefined; };
  if (span === null || typeof span !== "object") return drop("is not a span");
  const rulesOf = rules.services[service];
  if (typeof span.name !== "string" || !rulesOf.names.test(span.name)) return drop("is not an operation of ours");
  if (Array.isArray(span.links) && span.links.length > 0) return drop("has links");
  if (!hex(span.traceId, 32) || !hex(span.spanId, 16)) return drop("has no valid ids");
  const root = span.parentSpanId === undefined || span.parentSpanId === "" || /^0{16}$/.test(span.parentSpanId);
  if (!root && !hex(span.parentSpanId, 16)) return drop("has no valid parent id");
  const start = nanos(span.startTimeUnixNano);
  const end = nanos(span.endTimeUnixNano);
  // Before the first Monday of 1970 a week would start before the epoch; from 2^63 a time is no int64.
  if (start === undefined || end === undefined || start < monday || end < start || end >= int64) return drop("has no valid times");
  const kind = enumValue(span.kind, kindNames);
  if (kind < 0 || kind > 5) return drop("has no valid kind");
  if (rulesOf.kinds && !rulesOf.kinds.includes(kind)) return drop(`is not a ${kindNames[kind]} span`);
  const status = enumValue(span.status?.code, statusNames);
  if (status < 0 || status > 2) return drop("has no valid status");
  const day = weekOf(start);

  const attributes = keepAll(rules, rules.span, span.attributes, service, { ...options, week: day }, where);
  if (attributes === undefined) return drop("gives an attribute twice");
  for (const key of rulesOf.requires) if (!attributes.has(key)) return drop(`has no ${key}`);
  keepNames(rules, attributes, service, kind);
  let name = span.name;
  if (name === toolCall || name.startsWith(`${toolCall} `)) {
    const tool = attributes.get(toolKey);
    name = tool?.type === "string" ? `${toolCall} ${tool.value}` : toolCall;
  }
  const session = attributes.get(sessionKey)?.value;
  // A place in a session means nothing without the session.
  if (session === undefined) attributes.delete(offsetKey);
  else if (options.sessionOffset) attributes.set(offsetKey, { type: "int", value: options.sessionOffset(session, start) });
  if (end > start) attributes.set("span.duration_ms", { type: "double", value: Number((end - start) / 1_000_000n) });
  else if (!attributes.has("span.duration_ms")) attributes.set("span.duration_ms", { type: "double", value: 0 });

  // Ids hash within their session and week: a caller's constant trace context links no two sessions.
  const id = (tag, value, length) => (options.hash ? options.hash(tag, `${day}:${session ?? ""}:${value.toLowerCase()}`, length) : value.toLowerCase());
  return {
    traceId: id("trace", span.traceId, 32),
    spanId: id("span", span.spanId, 16),
    ...(root ? {} : { parentSpanId: id("span", span.parentSpanId, 16) }),
    name,
    kind,
    startTimeUnixNano: String(day),
    endTimeUnixNano: String(day),
    attributes: [...attributes].map(([key, value]) => ({ key, value: write(value) })),
    status: status === 0 ? {} : { code: status },
  };
}

/**
 * A traces export request as the rules keep it: only PLexus's and MCP's
 * spans, each attribute in its shape, names only where they may be kept,
 * times to the week with each duration kept, ids hashed; or null when
 * nothing is left, or the request is not one.
 *
 * @param {ReturnType<typeof compile>} rules
 * @param {any} request an OTLP JSON ExportTraceServiceRequest
 * @param {{
 *   hash?: (tag: string, value: string, length?: number) => string,
 *   report?: (problem: string) => void,
 *   sessionOffset?: (session: string, start: bigint) => bigint,
 * }} [options]
 *   without `hash`, ids and session ids are kept as they are, as `npm run audit` reads an archive;
 *   with `sessionOffset`, each span with a session gets its offset in it, as the agent adds it
 */
function transformTraces(rules, request, options = {}) {
  const settings = { hash: options.hash, report: options.report ?? (() => {}), sessionOffset: options.sessionOffset };
  if (request === null || typeof request !== "object" || !Array.isArray(request.resourceSpans)) return null;
  const resourceSpans = [];
  for (const each of request.resourceSpans) {
    const attributes = each?.resource?.attributes;
    const service = Array.isArray(attributes) ? attributes.find((entry) => entry?.key === "service.name")?.value?.stringValue : undefined;
    if (!Object.hasOwn(rules.services, service)) {
      settings.report(`resource: service.name ${service === undefined ? "is missing" : `${JSON.stringify(service)} is not ours`}`);
      continue;
    }
    const resource = keepAll(rules, rules.resource, attributes, service, settings, "resource");
    if (resource === undefined) {
      settings.report("resource: gives an attribute twice");
      continue;
    }
    const scopeSpans = [];
    for (const scoped of Array.isArray(each.scopeSpans) ? each.scopeSpans : []) {
      if (scoped?.scope?.name !== rules.services[service].scope) {
        settings.report(`scope ${scoped?.scope?.name ?? "?"} is not ${service}'s`);
        continue;
      }
      if ((scoped.scope.attributes ?? []).length > 0) settings.report("a scope keeps attributes");
      const version = scoped.scope.version;
      const spans = (Array.isArray(scoped.spans) ? scoped.spans : []).map((span) => keepSpan(rules, span, service, settings)).filter(Boolean);
      if (spans.length === 0) continue;
      scopeSpans.push({
        scope: { name: scoped.scope.name, ...(typeof version === "string" && rules.version.test(version) ? { version } : {}) },
        spans,
      });
    }
    if (scopeSpans.length === 0) continue;
    resourceSpans.push({
      resource: { attributes: [...resource].map(([key, value]) => ({ key, value: write(value) })) },
      scopeSpans,
    });
  }
  return resourceSpans.length === 0 ? null : { resourceSpans };
}

/** How many sessions the agent remembers the first span of, and how long after its last span. */
const sessionMemory = { sessions: 10_000, idle: 3_600_000 };

/**
 * Where each span comes in its session: milliseconds from the first span of
 * that session the agent saw, negative for one that started before it. A
 * session is forgotten an hour after its last span, the oldest first past
 * the cap. `sessions` is kept in the order of their last span, so the ones
 * to forget are always first: a new session costs no scan of the others.
 * The agent gives the map it keeps across its restarts.
 *
 * @param {() => number} [now]
 * @param {Map<string, { first: bigint, seen: number }>} [sessions] hashed session ids, by last span
 */
function sessionOffsets(now = Date.now, sessions = new Map()) {
  return (session, start) => {
    const at = now();
    let entry = sessions.get(session);
    if (entry === undefined || at - entry.seen > sessionMemory.idle) {
      entry = { first: start, seen: at };
      for (const [each, { seen }] of sessions) {
        if (at - seen <= sessionMemory.idle && sessions.size < sessionMemory.sessions) break;
        sessions.delete(each);
      }
    }
    entry.seen = at;
    sessions.delete(session);
    sessions.set(session, entry);
    return (start - entry.first) / 1_000_000n;
  };
}

/**
 * The function the agent calls before it sends anything: traces as the rules
 * keep them, each span with its place in its session, and nothing of the
 * other signals, which the collector does not take. Without a key, nothing is
 * sent: ids are never sent unhashed.
 *
 * @param {any} allowlist
 * @param {string | undefined} key
 * @param {{ offsets?: boolean, sessions?: Map<string, { first: bigint, seen: number }> }} [options] `offsets: false` leaves out the places, as the collector, which cannot know them; `sessions`, the first span of each session the agent saw, which it keeps across its restarts
 */
function createTransform(allowlist, key, { offsets = true, sessions } = {}) {
  const rules = compile(allowlist);
  const hash = typeof key === "string" && /^[0-9a-f]{32,128}$/.test(key) ? keyedHash(key) : undefined;
  const sessionOffset = offsets ? sessionOffsets(Date.now, sessions) : undefined;
  return (signal, request) => {
    if (signal !== "traces" || hash === undefined) return null;
    try {
      return transformTraces(rules, request, { hash, sessionOffset });
    } catch {
      return null;
    }
  };
}

let key;
try {
  key = readFileSync(new URL("./telemetry-transform.key", import.meta.url), "utf8").trim();
} catch {
  key = undefined;
}

export default createTransform(allowlist, key);

/** The same filter with another key, as `preview` runs it; without the places in sessions with `{ offsets: false }`. */
export const filter = (other, options) => createTransform(allowlist, other, options);
