<!-- Generated from collector/allowlist.json, collector/catalog.json and src/collector.js by `npm run generate`. Do not edit. -->
# What the Pharo tools send when you join

The Pharo agent tools (the pharo-agent plugin, PLexus and Pharo MCP) can
record how agents use them, so the tools can change to fit that use: tools
nobody reaches, arguments agents expect but the tools do not take, answers
that are too long, mistakes agents repair. Joining is opt-in, and nothing is
sent until you join. The tools never ask you to.

## How it leaves your machine

Only through the agent `join` installs: a small program that runs as a
service of your user account, listens on a port of your own machine
(127.0.0.1), takes what the tools send it, keeps only what this page lists,
and sends that to the collector. The tools' settings point them at the agent
and hold no token: the agent alone knows the collector. PLexus, the images it
starts, and an image you start yourself once it is set up as "With MCP alone"
says, all send to the agent.

The collector applies the same rules again to whatever arrives, and drops
what they do not keep. Both are made from one list, and so is this page.

The agent updates its lists of our tools' names and words, and nothing else,
from the project's server: at most once a day it asks the collector's server
for a newer catalog, and takes it only when the project's key signed it. A
catalog can only add, and only to the lists that grow with our releases
(MCP tools, PLexus tools, pharo-image-fs tools, project words, guessed words, PLexus error codes, Node exception classes, MCP exception classes): it never removes a name, adds an agent host or any other value,
or changes which attributes are kept or in what shape. The project's key can
thus add names and words to those lists, which would let names made of such
words through; `status` shows what the catalog in use added. Were that key
compromised, it would be replaced only by joining again with a package that
names a new one.

## What is kept

Only PLexus's and MCP's spans of the operations they record:

- from `plexus`, with its scope `@evref-bl/plexus`: `tools/call <tool>`, `tools/list`, `plexus.image.create`, `plexus.image.start`, `plexus.image.stop`, `plexus.image.delete`, of every kind and only with `session.id`.
- from `pharo-mcp`, with its scope `mcp-pharo`: `tools/call <tool>`, of kind server only and only with `session.id`.

Any other span is dropped whole, such as one your own OpenTelemetry code
makes in an image, and so is a span that has links. Metrics and logs are not
kept at all. A span your own code makes of kind server, with the tracer
`mcp-pharo`, named `tools/call` and a name, and with a `session.id`, cannot be
told from MCP's: it is kept as `tools/call _OTHER`, or with its tool's name
when that name passes as "Names" says, with nothing but what this page lists.

Of each span, only this is kept:

- its operation, `tools/call` followed by the tool's name when the attributes
  below keep it;
- its kind (server, client, internal...) and its status (unset, ok, error),
  never a status message;
- its instrumentation scope's name, and its version when it has a version's
  shape;
- its trace, span and parent ids, each replaced by a keyed hash, within its
  session and week: by the agent, with a key `join` makes and that never
  leaves your machine, then again at the collector, with a key of its own
  that never enters the archive. A call's spans still group, but nothing
  joins them to anything else, nor one session's to another's, even when the
  agent host gives every session the same trace;
- its start time, to the week (the Monday it falls in, at midnight UTC), its
  end time set to the same, how long it took, in whole milliseconds, as
  `span.duration_ms`, and, for a span with a session, when it started in
  milliseconds after the first span of that session the agent saw, as
  `pharo_agent_telemetry.session.offset_ms`;
- the attributes below, from the tools named, each only in the shape given: a
  value of any other shape is dropped, or replaced as the table says.

Never its events, links, trace state or status message, nor its scope's
attributes. Any value that contains a home directory path, an email address, an IPv4 address, an IPv6 address is
masked, whole, and the mask has no attribute's shape.

### Names

A name an agent or another package chooses (`gen_ai.tool.name`, `plexus.argument.names`, `plexus.argument.unknown_names`, `pharo.mcp.argument.names`, `pharo.mcp.argument.unknown_names`, `pharo.mcp.tool.refs`, `pharo.mcp.error.code`, `pharo.mcp.error.schema.paths`) is kept only
when it is the name of a tool a project publishes, or when every word of it
(split at `_`, `-` and capitals) is in the vocabulary: the
1172 words of the names in the code of MCP, PLexus and
pharo-image-fs (their tools, arguments, errors and the rest), read from
their source (MCP v4.3.0, PLexus v0.21.0, pharo-image-fs v0.14.0), and of a list of words agents guess. Any
other name is dropped, or becomes `_OTHER`. A name is kept only when it is
made of words our tools use, so a name of your own made only of such words
can pass, such as a class `ClassName` or an argument `class_name`; a name
with any other word in it cannot. Both lists are in
[collector/catalog.json](../collector/catalog.json) and
[collector/allowlist.json](../collector/allowlist.json).

The names of a tool another package added to an image (`pharo.mcp.tool.origin`
`other`, or no origin) are not kept: its tool's name becomes `_OTHER` and
the other names are dropped, unless a project publishes that tool. PLexus
names only its own tools: on a call PLexus passes on to an image, its span
keeps the tool's name only when a project publishes it, and never the
arguments' names, which the image's span reports as above. An error code is
kept only for MCP's own tools.

Where it ran:

| Attribute | From | What it is | Kept as |
| --- | --- | --- | --- |
| `service.name` | plexus, pharo-mcp | Which tool sent the span. | one of `plexus`, `pharo-mcp` |
| `service.version` | plexus, pharo-mcp | That tool's version. | a version |
| `os.type` | plexus, pharo-mcp | The OS family. | one of the OS types |
| `process.runtime.name` | plexus, pharo-mcp | nodejs or pharo. | one of `nodejs`, `pharo` |
| `process.runtime.version` | plexus, pharo-mcp | Node's major version, or Pharo's major and minor. | a version, major from plexus, major and minor from pharo-mcp |
| `deployment.environment.name` | plexus, pharo-mcp | field for participants, eval for our own evaluation runs, preview while previewing, check for npm run check-deployment. | one of `field`, `eval`, `preview`, `check` |
| `pharo_agent_evals.variant` | plexus, pharo-mcp | Which variant of an evaluation run sent the span: the build under test, which may report a released version. Kept only for eval. | a build's name, only beside `deployment.environment.name` `eval` |

What happened:

| Attribute | From | What it is | Kept as |
| --- | --- | --- | --- |
| `session.id` | plexus, pharo-mcp | Groups the calls of one working session. PLexus makes it at random, or MCP when the call came without one, and either starts another after 30 minutes without a call; it is replaced by its keyed hash before it leaves your machine. | its keyed hash, within its week |
| `mcp.method.name` | plexus, pharo-mcp | The MCP method. | one of `tools/call`, `tools/list` |
| `mcp.protocol.version` | pharo-mcp | The MCP protocol version the client's request declared, a date. | a date |
| `gen_ai.tool.name` | plexus, pharo-mcp | The tool's name: one a project publishes, else a name the agent asked for that no tool has, or MCP's own, when made of words of the vocabulary. | a tool a project publishes, else an identifier made of the vocabulary's words, else `_OTHER` |
| `error.type` | plexus, pharo-mcp | How a call failed: tool_error, a JSON-RPC or HTTP code, how a connection failed, a PLexus error code, or an exception class of Pharo, MCP or Node. | one of the call failures, PLexus error codes, Node exception classes or MCP exception classes, or a numeric code, else `_OTHER` |
| `plexus.client.name` | plexus | The agent host, as it introduces itself to PLexus's server, when it is one the allowlist knows. | one of the agent hosts, else `_OTHER` |
| `plexus.client.version` | plexus | The agent host's version, major and minor, beside a name the allowlist knows. | a version, major and minor, only beside a `plexus.client.name` of that set |
| `plexus.call.index` | plexus | Where the call comes in its session: 1 for the first. | a whole number from 1 |
| `plexus.call.forwarded` | plexus | Whether PLexus passed the call on to an image, which then names the tool. | true or false |
| `plexus.argument.names` | plexus | The names of the arguments a call to one of PLexus's own tools gave, never their values. | a list of at most 32, each an identifier, made of the vocabulary's words |
| `plexus.argument.unknown_names` | plexus | Argument names a call gave that PLexus's own tool does not take. | a list of at most 32, each an identifier, made of the vocabulary's words |
| `plexus.error.code` | plexus | Why PLexus refused a call before any image saw it. | one of the PLexus error codes, else `_OTHER` |
| `plexus.image.save` | plexus | Whether stopping an image saved it. | true or false |
| `pharo.mcp.tool.origin` | pharo-mcp | mcp for one of MCP's own tools, other for a tool another package added, unknown for a name no tool has. Names are kept only for mcp and unknown. | one of `mcp`, `other`, `unknown`, else `other` |
| `pharo.mcp.dispatch_path` | pharo-mcp | How the image dispatched the request. | one of `direct`, `via_tool_call` |
| `pharo.mcp.client.name` | pharo-mcp | The agent host, as it introduces itself to MCP's server, when it is one the allowlist knows: under PLexus, PLexus itself. | one of the agent hosts, else `_OTHER` |
| `pharo.mcp.client.version` | pharo-mcp | Its version, major and minor, beside a name the allowlist knows. | a version, major and minor, only beside a `pharo.mcp.client.name` of that set |
| `pharo.mcp.argument.names` | pharo-mcp | The names of the arguments the tool declares that the call gave, never their values. | a list of at most 32, each an identifier, made of the vocabulary's words |
| `pharo.mcp.argument.unknown_names` | pharo-mcp | Argument names the call gave that the tool does not declare. | a list of at most 32, each an identifier, made of the vocabulary's words |
| `pharo.mcp.argument.options` | pharo-mcp | The options the call chose, as the evaluations count them: a property, a value of an enumeration, or a list given for several targets. | a list of at most 32, each an option |
| `pharo.mcp.input.bytes` | pharo-mcp | The size of the arguments. | the lower bound of its bucket: 0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576, 2097152, 4194304, 8388608, 16777216 |
| `pharo.mcp.output.bytes` | pharo-mcp | The size of the answer. | the lower bound of its bucket: 0, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, 1048576, 2097152, 4194304, 8388608, 16777216 |
| `pharo.mcp.output_budget.exceeded` | pharo-mcp | Whether the answer was cut to fit the output budget, which its size, kept in buckets, does not say. | true or false |
| `pharo.mcp.result.count` | pharo-mcp | How many results a search answered. | the lower bound of its bucket: 0, 1, 2, 6, 21, 101 |
| `pharo.mcp.result.more` | pharo-mcp | Whether there were more results than answered. | true or false |
| `pharo.mcp.test.outcome` | pharo-mcp | How a test run ended. | one of `passed`, `failed`, `errored`, `none` |
| `pharo.mcp.test.count` | pharo-mcp | How many tests ran. | the lower bound of its bucket: 0, 1, 2, 6, 21, 101 |
| `pharo.mcp.tool.refs` | pharo-mcp | The tools a discovery call (tool_search, tool_get) named. | a list of at most 16, each a tool a project publishes, else `_OTHER` |
| `pharo.mcp.error.kind` | pharo-mcp | The kind of error MCP reported. | one of `input_schema`, `domain`, `tool_result`, `json_rpc`, `exception` |
| `pharo.mcp.error.code` | pharo-mcp | The error code MCP gave its answer. | an identifier, made of the vocabulary's words, else `_OTHER`, only for MCP's own tools |
| `pharo.mcp.error.schema.violation_count` | pharo-mcp | How many times the arguments broke the tool's input schema, where the rules and places they broke are each named once. | the lower bound of its bucket: 0, 1, 2, 6, 21, 101 |
| `pharo.mcp.error.schema.keywords` | pharo-mcp | Which schema rules they broke. | a list of at most 8, each one of the schema keywords |
| `pharo.mcp.error.schema.paths` | pharo-mcp | Where in the tool's input they broke them. | a list of at most 8, each a JSON pointer, each name in it made of the vocabulary's words |
| `pharo.mcp.exception.type` | pharo-mcp | The nearest Pharo or MCP class of an exception. | one of the MCP exception classes, else `_OTHER` |
| `span.duration_ms` | plexus, pharo-mcp | How long the span took, in whole milliseconds, kept since its times are not. | a whole number from 0 |
| `pharo_agent_telemetry.session.offset_ms` | plexus, pharo-mcp | When the span started, in milliseconds after the first span of its session the agent on your machine saw (negative when it saw a later one first): the order of a session's calls, never a time of day. | a whole number |

The closed sets the table names, the tools each project publishes among them:

- OS types: `windows`, `linux`, `darwin`, `freebsd`, `netbsd`, `openbsd`, `dragonflybsd`, `hpux`, `aix`, `solaris`, `z_os`.
- PLexus error codes: `invalid-name`, `no-such-image`, `image-exists`, `image-running`, `being-started`, `building`, `not-running`, `starting`, `no-endpoint`, `unknown-template`, `ambiguous-template`, `script-not-found`, `create-failed`, `start-failed`, `stop-failed`, `save-failed`, `stopped-unsaved`, `launcher-failed`, `invalid-arguments`, `no-image-running`, `several-images`, `none-takes-calls`.
- call failures: `tool_error`, `_OTHER`, `timeout`, `refused`, `closed`, `cancelled`.
- Node exception classes: `Error`, `AbortError`, `AggregateError`, `EvalError`, `RangeError`, `ReferenceError`, `SyntaxError`, `SystemError`, `TimeoutError`, `TypeError`, `URIError`.
- schema keywords: `type`, `enum`, `const`, `required`, `properties`, `additionalProperties`, `patternProperties`, `propertyNames`, `minProperties`, `maxProperties`, `dependentRequired`, `items`, `prefixItems`, `contains`, `minItems`, `maxItems`, `uniqueItems`, `minLength`, `maxLength`, `pattern`, `format`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`, `oneOf`, `anyOf`, `allOf`, `not`, `notBlank`, `notEmpty`, `methodReference`, `selectionRequired`.
- agent hosts: `@cline/core`, `augment-mcp-client`, `claude-ai`, `claude-code`, `Cline`, `Code - OSS`, `codex-mcp-client`, `continue-cli-client`, `continue-client`, `crush`, `cursor-vscode`, `dev.warp.Warp`, `gemini-cli-mcp-client`, `github-copilot-developer`, `goose`, `goose-cli`, `goose-desktop`, `hermes-mcp-client`, `inspector`, `inspector-cli`, `inspector-client`, `inspector-tui`, `jetbrains-ai-assistant-client`, `junie-client`, `kilo`, `Kilo Code`, `kiro`, `mcp-inspector`, `opencode`, `plexus`, `Q DEV CLI`, `qwen-code-mcp-client`, `Roo Code`, `Visual Studio Code`, `Visual Studio Code - Insiders`, `VSCodium`, `VSCodium - Insiders`, `Windsurf`, `windsurf-client`, `Zed`.
- MCP tools: `class_create`, `class_get`, `class_remove`, `class_search`, `class_update`, `critique_run`, `debug_search`, `debug_watch`, `evaluate`, `history_entry_apply`, `history_entry_list`, `history_entry_revert`, `history_file_list`, `history_lost_change_list`, `history_lost_change_restore`, `method_compile`, `method_get`, `method_reference_search`, `method_remove`, `method_restore`, `method_rewrite`, `method_search`, `method_source_search`, `method_update`, `method_version_list`, `package_search`, `repository_attach`, `repository_change_discard`, `repository_change_list`, `repository_commit`, `repository_create`, `repository_export`, `repository_head_adopt`, `repository_identity_verify`, `repository_reload`, `repository_search`, `repository_update`, `screen_capture`, `screen_read`, `test_coverage_run`, `test_run`, `tool_call`, `tool_get`, `tool_search`.
- PLexus tools: `image_create`, `image_delete`, `image_list`, `image_start`, `image_stop`, `image_templates`.
- pharo-image-fs tools: `pifs_list`, `pifs_start`, `pifs_stop`.
- MCP exception classes: `AINotADAG`, `Abort`, `ArgumentsCountMismatch`, `ArithmeticError`, `AssertionFailure`, `AuthorNameRequest`, `AutomaticRewriting`, `BCFailingOnPurposeForTestError`, `BackwardCompatibility`, `BackwardCompatibleRewritingCallPerformedNotification`, `BlockCannotReturn`, `Break`, `CDUnrecognizedClassPart`, `CRCError`, `CannotDecompileNativeBoostCalls`, `CannotDeleteFileException`, `CannotIdentifyVersionForCommit`, `CannotReturn`, `CircularHierarchyError`, `ClapDbgHistoryEventNotFound`, `ClapUnmatchCommand`, `ClassBuilderError`, `ClyInvalidClassForTestClassGeneration`, `ClyNoChildrenError`, `CmCommandAborted`, `CmCommandError`, `CmDuplicatedEntryName`, `CmNoShortcutIsDefined`, `CmdCommandAborted`, `CodeError`, `CodeImportError`, `CollectionIsEmpty`, `ConfirmationRequest`, `ConnectionClosed`, `ConnectionRefused`, `ConnectionTimedOut`, `ContextCannotReturn`, `ContextNotOnStack`, `DAPotentialOutDatedDependencyWarning`, `DAUnknownManuallyResolvedPackage`, `DateError`, `DebugAttemptToRewindPostMortemError`, `DebuggedExecutionException`, `DebuggedExecutionIsFinished`, `Deprecation`, `DeprecationPerformedNotification`, `DirectoryDoesNotExist`, `DirectoryExists`, `DirectoryIsNotEmpty`, `DirtyTestError`, `DomainError`, `DuplicatedSlotName`, `DuplicatedVariableError`, `Error`, `ErrorNonInteractive`, `Exception`, `Exit`, `ExtensionConflictError`, `ExtensionPointsOwningPackageNotification`, `FFIDereferencedOpaqueObjectError`, `FFIUnsupportedUntypedLiteral`, `FFIVariableNameNotFound`, `FLBadSignature`, `FLBadVersion`, `FLClassNotFound`, `FLConfigurationError`, `FLDebuggerStackMaterialization`, `FLError`, `FLGlobalNotFound`, `FLMaterializationError`, `FLMethodChanged`, `FLMethodNotFound`, `FLNotSerializable`, `FLObjectLimitExceededWarning`, `FLObjectNotFound`, `FLObsolete`, `FLSerializationError`, `FLWarning`, `FT2Error`, `FileAlreadyExistsException`, `FileAttributeNotSupported`, `FileDoesNotExistException`, `FileException`, `FileExists`, `FileSystemError`, `FileWriteError`, `FontSubstitutionDuringLoading`, `GeometryError`, `GoferRepositoryError`, `HTTPProgress`, `Halt`, `IceAuthenticationError`, `IceBranchAlreadyExists`, `IceBranchAlreadyExistsError`, `IceBranchNotFound`, `IceCheckoutConflictError`, `IceCloneError`, `IceCloneLocationAlreadyExists`, `IceCloneRemoteNotFound`, `IceDuplicatedRepository`, `IceError`, `IceExperimentalFeature`, `IceGenericError`, `IceGitHubBadCredentialsError`, `IceGitHubError`, `IceGitHubGenericError`, `IceGitUsernameOrEmailNotFound`, `IceLocalRepositoryMissing`, `IceMergeAborted`, `IceMergeResolutionRequest`, `IceMetacelloDuplicatedNotification`, `IceMissingRepositoryEntry`, `IceNoCommitMessage`, `IceNoRemote`, `IceNoRemoteBranch`, `IceNotInBranch`, `IceNothingToCommit`, `IceRemoteAlreadyExistsError`, `IceRemoteDesynchronized`, `IceRemoteNotFoundError`, `IceShouldCommitBeforePull`, `IceTagAlreadyExists`, `IceTagNotFound`, `IceUpstreamNotConfigured`, `IceVersionDoesNotExist`, `IceWarning`, `IceWorkingCopyDesyncronized`, `IceWrongUrl`, `IllegalFileName`, `IllegalName`, `IllegalResumeAttempt`, `IncompatibleLayoutConflict`, `InformativeNotification`, `InstanceVariableNotFound`, `InvalidGlobalName`, `InvalidSlotName`, `InvalidSocketStatusException`, `KeyNotFound`, `LGitAbstractError`, `LGitCallError`, `LGitCallReturnHandler`, `LGitIllegalArgument`, `LGitNoCredentialsProvided`, `LGitNoReturnCodeHandlerDefined`, `LGitObjectNotFound`, `LGitObjectNotInitialized`, `LGitOpeningRepositoryError`, `LGitRepositoryNotFound`, `LGitWritingTreeFailed`, `LGit_GIT_EAMBIGUOUS`, `LGit_GIT_EAPPLIED`, `LGit_GIT_EAUTH`, `LGit_GIT_EBAREREPO`, `LGit_GIT_EBUFS`, `LGit_GIT_ECERTIFICATE`, `LGit_GIT_ECONFLICT`, `LGit_GIT_EEOF`, `LGit_GIT_EEXISTS`, `LGit_GIT_EINVALID`, `LGit_GIT_EINVALIDSPEC`, `LGit_GIT_ELOCKED`, `LGit_GIT_EMODIFIED`, `LGit_GIT_ENONFASTFORWARD`, `LGit_GIT_ENOTFOUND`, `LGit_GIT_EORPHANEDHEAD`, `LGit_GIT_EPEEL`, `LGit_GIT_ERROR`, `LGit_GIT_EUNBORNBRANCH`, `LGit_GIT_EUNCOMMITTED`, `LGit_GIT_EUNMERGED`, `LGit_GIT_EUSER`, `LGit_GIT_ITEROVER`, `LGit_GIT_OK`, `LGit_GIT_PASSTHROUGH`, `LoginFailedException`, `MCChangeSelectionRequest`, `MCCredentialsRequest`, `MCMergeOrLoadWarning`, `MCMergeResolutionRequest`, `MCNoChangesException`, `MCPCommandError`, `MCPHeaderMismatch`, `MCPInvalidToolInput`, `MCPMissingPromptArgument`, `MCPResourceNotFound`, `MCPSyntaxError`, `MCPUnknownCompletionReference`, `MCPUnknownPrompt`, `MCPUnsupportedProtocolVersion`, `MCPermissionDenied`, `MCRepositoryError`, `MCVersionNameAndMessageRequest`, `MessageNotUnderstood`, `MetacelloAllowConflictingProjectUpgrade`, `MetacelloAllowLockedProjectChange`, `MetacelloAllowProjectDowngrade`, `MetacelloAllowProjectUpgrade`, `MetacelloCannotUpdateReleasedVersionError`, `MetacelloCleanLoadAndTestsNotification`, `MetacelloCleanLoadNotification`, `MetacelloCleanNotification`, `MetacelloClearStackCacheNotification`, `MetacelloConflictingProjectError`, `MetacelloError`, `MetacelloErrorInProjectConstructionNotification`, `MetacelloIgnorePackageLoaded`, `MetacelloLookupBaselineSpecForEnsureLoad`, `MetacelloLookupProjectSpec`, `MetacelloLookupProjectSpecForLoad`, `MetacelloNameNotDefinedError`, `MetacelloNoRootError`, `MetacelloNotification`, `MetacelloPackageSpecResolutionError`, `MetacelloProjectSpecLoadConflict`, `MetacelloProjectSpecLoadError`, `MetacelloProjectSpecLoadedNotification`, `MetacelloResolutionError`, `MetacelloResolveProjectUpgrade`, `MetacelloScriptEnsureProjectLoadedForDevelopment`, `MetacelloScriptGitBasedDownloadNotification`, `MetacelloScriptNotification`, `MetacelloScriptProjectSpecNotification`, `MetacelloScriptingError`, `MetacelloSkipDirtyPackageLoad`, `MetacelloStackCacheNotification`, `MetacelloSymbolicVersionDoesNotExistError`, `MetacelloSymbolicVersionNotDefinedError`, `MetacelloUseUpgradeError`, `MetacelloValidationFailure`, `MetacelloValidationNotification`, `MetacelloVersionDefinitionError`, `MetacelloVersionDoesNotExistError`, `MicGitHubAPIRateError`, `MicParsingError`, `MicPropertyError`, `MicResourceReferenceError`, `MirrorModificationForbidden`, `MissingClassError`, `MockExceptionWithPassAction`, `ModificationForbidden`, `MyHalt`, `MyResumableTestError`, `MyTestError`, `MyTestNotification`, `MyVariableNotDeclaredDummyClassForTest`, `NameLookupFailure`, `NetworkError`, `NewUndeclaredWarning`, `NoBroadcastAllowed`, `NoNetworkError`, `NodeNotInASTError`, `NonBooleanReceiver`, `NonObservableSlotError`, `NotFound`, `NotValidPcError`, `NotYetImplemented`, `NothingToRedo`, `NothingToUndo`, `Notification`, `OCCodeError`, `OCCompilationError`, `OCErrorNotice`, `OCNotice`, `OCRuntimeSyntaxError`, `OCSemanticError`, `OCSemanticWarning`, `OCShadowVariableWarning`, `OCStoreIntoReadOnlyVariableError`, `OCStoreIntoReservedVariableError`, `OCSyntaxErrorNotice`, `OCUndeclaredVariableNotice`, `OCUndeclaredVariableWarning`, `OCWarningNotice`, `OSWindowDriverNotFoundWarning`, `OmFileStoreReadingError`, `OmFileStoreWritingError`, `OupsDebuggerFailure`, `OupsNullException`, `OutOfMemory`, `PNGFormatError`, `POP3LoginError`, `PackageConflictError`, `PotentialOutDatedDependencyWarning`, `PrimitiveFailed`, `ProcessAlreadyTerminating`, `ProgressNotification`, `ProtocolClientError`, `ProtocolRemovalException`, `ProvideAnswerNotification`, `RBApplicabilityChecksFailedError`, `RBBreakingChangeChecksFailedWarning`, `RBErrorNotice`, `RBInputValidationFailedError`, `RBNotice`, `RBRefactoringError`, `RBRefactoringFailure`, `RBRefactoringWarning`, `RBSyntaxErrorNotice`, `RBWarningNotice`, `RGBadInstantiationError`, `RGIncompatibleBehaviorTypeError`, `RGJoiningError`, `RGMergeError`, `RGNotFoundError`, `RGResolvingError`, `RGWrongEnvironment`, `RPackageConflictError`, `RTFTestAnalysed`, `ReadOnlyFileException`, `RefactoringAborted`, `RegexCompilationError`, `RegexError`, `RegexMatchingError`, `RegexSyntaxError`, `ReparseAfterSourceEditing`, `ResolutionRequest`, `ResumableTestFailure`, `RuntimeSyntaxError`, `SDL2Error`, `STONReaderError`, `STONWriterError`, `SelectorException`, `ShNoChangesInClass`, `ShouldBeImplemented`, `ShouldNotImplement`, `SimulationExceptionWrapper`, `SindarinSkippingReturnWarning`, `SizeMismatch`, `SlotDeprecation`, `SlotNotFound`, `SocketError`, `SocketPrimitiveFailed`, `SpCancelledInteractionError`, `SpInteractionCancelled`, `SpInteractionError`, `SpInvalidUserInput`, `SpInvalidUserInputError`, `SpNonObservableSlotError`, `StDebuggeAssertionFailureContextNotFound`, `StGenerateAssertEqualsCode`, `StGenerateCode`, `StLimitArrived`, `StPotentialOutDatedDependencyWarning`, `StUnknownManuallyResolvedPackage`, `StartupPreferencesLoadingError`, `SteppingATerminatingProcess`, `SubclassResponsibility`, `SubscriptOutOfBounds`, `SymbolNotFoundError`, `SyntaxErrorNotification`, `SystemNotification`, `TFCallbackCannotReturn`, `TFIncorrectOrderCallbackReturn`, `TFInvalidSessionCallbackReturn`, `TKTCancelledTaskException`, `TKTRetryException`, `TKTTimeoutException`, `TabWithNoContents`, `TabWithNoContentsMorph`, `TelnetProtocolError`, `TestFailedByForkedProcess`, `TestFailure`, `TestLeftRunningProcess`, `TestSkipped`, `TestTookTooMuchTime`, `TimeError`, `TimedOut`, `TonelParseError`, `TonelShouldIgnore`, `TonelWriteError`, `UndeclaredVariableError`, `UndeclaredVariableRead`, `UndeclaredVariableWarning`, `UndeclaredVariableWrite`, `UndefinedClassError`, `UnhandledError`, `UnhandledException`, `UnhandledExceptionSignalledByADebuggedExecution`, `UnknownSettingType`, `UnrecognizedImageFormatError`, `UnwindError`, `ValueNotFound`, `VariableNotDeclared`, `Warning`, `ZdcPluginMissing`, `ZeroDivide`, `ZipArchiveError`, `ZipPasswordError`, `ZnByteStringBecameWideString`, `ZnCertificateVerificationFailed`, `ZnCharacterEncodingError`, `ZnEntityTooLarge`, `ZnHttpUnsuccessful`, `ZnIncomplete`, `ZnInvalidUTF8`, `ZnLineTooLong`, `ZnMissingHost`, `ZnParseError`, `ZnPortNotANumber`, `ZnRespond`, `ZnTooManyConcurrentConnections`, `ZnTooManyDictionaryEntries`, `ZnTooManyRedirects`, `ZnUnexpectedContentType`, `ZnUnknownHttpMethod`, `ZnUnknownHttpStatusCode`, `ZnUnknownHttpVersion`, `ZnUnknownScheme`.

## What is never sent

- Argument values, results, source code, prompts, file contents.
- Exception messages and stacks.
- Paths and image names.
- Any name with a word the vocabulary does not have, as most names of your
  projects, classes, methods and packages have; a name made only of its
  words can pass, as "Names" says.
- Host names, user names, email addresses, IP addresses.
- Any identifier of you or your machine. There are no participant ids.
- Precise times: only the week, how long each span took, and its place in
  its session.

## Is it anonymous?

The archive is. A session's spans share a `session.id`: PLexus makes one at
random for the calls of an agent host, and MCP makes one when a call comes
without one (MCP's part ships in its next release; until then a call to MCP
alone carries no session, and is not kept). The agent hashes it within its
week, and the collector again, so the calls of one session can be studied
together, and in order, but no id links a session to another session, to a
machine or to a person.

Nothing in a span says who sent it. What could still set a participant
apart is a rare setup: what a span says of where it ran (the versions of
PLexus and MCP, Node's major version, Pharo's major and minor, the agent host
and its major and minor version, and the OS family) is shared by everyone
with the same setup, but a combination nobody else has would set that
person's sessions apart from the others'. Someone who already knew that a
person runs that combination could tell which sessions are theirs, and learn
from them only how that person used the tools. The agent host's and
Pharo's versions are kept to major and minor, and Node's to major, so that
such combinations are rarer.

One thing about you does reach the server, as it reaches any server you
connect to: your IP address, so that the connection can be made. The proxy in
front of the collector passes it on to nothing, and writes it nowhere: it
keeps no access log, and its error log, which would hold it, is switched off.
That moment is the only processing of personal data here, and this page is
its notice.

## Who answers for it

*The controller and how to reach them: not set yet. Nobody can join until it is.* Its data protection officer can be reached at **[DPO CONTACT: TO BE FILLED IN src/collector.js BEFORE PUBLISHING]**.

## Who else holds it

*Where the collector runs, the GitLab that copies its archive, and where the archive is kept: not set yet. Nobody can join until it is.*

Nobody else receives it.

## Why, and on what basis

To change the tools from how agents use them, rather than from our own
sessions alone. The basis is your consent: running `join` after reading this
page gives it, and `leave` withdraws it, at any time and with no effect on
what the tools do for you.

## How long

The collector writes what arrives into one file a day, named after the day
it arrived, a day the file's spans also carry; the import keeps neither. The
collector never deletes a file the daily import has not loaded, and the
import deletes each file once Elasticsearch holds its spans. Should the
import stop, the collector refuses new spans once its archive takes half its
disk's free space, rather than delete any. Elasticsearch keeps the spans in
one index a month, under the lifecycle policy as the import repository ships
it, which deletes each index twelve months after it was made. Reports
derived from them hold counts, never spans, and are kept.

## Your rights

You can withdraw at any time with `leave`, and nothing is sent from then on.
Access, correction and erasure apply to data about a person; since nothing in
the archive is about one, or can be traced back to one, there is nothing to
look up, correct or delete for you (GDPR Art. 11), and what was sent before
you left stays in the archive, as anonymous as it arrived. You can complain to
your data protection authority; in France, the CNIL (cnil.fr).

## Joining and leaving

With Node 22.15 or later:

```sh
npx @evref-bl/pharo-agent-telemetry preview   # see what would be sent, sending nothing
npx @evref-bl/pharo-agent-telemetry join
npx @evref-bl/pharo-agent-telemetry status
npx @evref-bl/pharo-agent-telemetry leave
```

`join` copies the agent into `pharo-agent-telemetry/` under
`~/.config` (`$XDG_CONFIG_HOME` when set, `%APPDATA%` on Windows), with its
key, and runs it as a service that starts when you log in and again if it
fails: a LaunchAgent on macOS, a systemd user unit on Linux, a scheduled task
at logon on Windows, which runs it with no window and starts it again 30
seconds after it fails. Its port is below the range your system hands out to
other programs, so that none takes it while the agent is down. Then it writes a block of settings, between two marked lines,
in PLexus's settings file, `plexus/otel.env`, and in MCP's,
`pharo-mcp/otel.env`, under `~/.config` (`%APPDATA%` on Windows), and under
`$XDG_CONFIG_HOME` too when it is set:

```text
# pharo-agent-telemetry: joined. Run `npx @evref-bl/pharo-agent-telemetry leave`, or delete these lines down to the end line, to stop.
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:<its port>
OTEL_EXPORTER_OTLP_PROTOCOL=http/json
OTEL_TRACES_EXPORTER=otlp
OTEL_BSP_SCHEDULE_DELAY=1000
OTEL_METRICS_EXPORTER=none
OTEL_LOGS_EXPORTER=none
OTEL_LOG_LEVEL=none
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=field
# pharo-agent-telemetry: end
```

A settings file you already had is kept beside it, as
`otel.env.before-join`, and `leave` puts it back; `join` refuses to replace
OpenTelemetry settings of your own unless you add `--force`. Your own
OpenTelemetry code in an image then sends to the agent too, which drops its
spans but those "What is kept" says it cannot tell from MCP's.

Where your system will not run a service of your account (over SSH on macOS,
or on Linux without a systemd user session), `join --no-service` installs
none: the agent then sends only while
`npx @evref-bl/pharo-agent-telemetry agent` runs.

PLexus reads its file at start, and passes it on to the images it starts; an
image reads MCP's at every start. From PLexus's and MCP's next releases, a
tool's file replaces any OpenTelemetry settings (`OTEL_*`) it inherits from
the agent host; before, an agent host that passes such settings sends the
tools' spans where they say instead. Restart your agent host after joining:
images made before that restart send nothing until they are made again.

`status` says whether the agent answers on its port, and what it received
and sent. `preview` runs an agent in the foreground with sending off and
prints what it would send: not joined, it points the tools at itself until
you stop it, and they read that when they start, so restart your agent host
and images; joined, it takes the agent's place on its port while it runs, so
the tools already running show in it, and starts the agent again after.

`leave` stops and removes the agent, its files and its key, and both blocks,
wherever the settings may be. Sending stops at once: PLexus and the images
then find the agent's port closed, and nothing else leaves your machine.
Images keep running.

If the collector cannot be reached, the agent stops trying for a while; the
tools never slow down or fail a call because of it.

### With MCP alone

Using Pharo MCP in your own image, without PLexus? It records calls from
MCP's next release, which makes a session of its own. Join as above, then,
in the image:

1. Load MCP's `Telemetry` group from the repository you loaded MCP from:
   the same `baseline: 'MCP'; repository: ...` as when you loaded it, with
   `load: #( 'Telemetry' )`.
2. Evaluate `MCP useOpenTelemetryObservabilityByDefault`, which switches
   every MCP server of the image, and save the image. Unsaved, the setting is
   lost at the next start.

The image reads MCP's settings file at every start, so it sends to the agent
from then on. Several projects that use the same image's server share one
session. An image in a container cannot reach the agent: the container's
127.0.0.1 is not your machine's.
