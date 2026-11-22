"The names MCP's OpenTelemetry backend can give the class of a failure in
this image, as pharo.mcp.exception.type: those of every exception class and
of every compiler notice (OCNotice's from Pharo 13, RBNotice's in Pharo 12),
which an answer names as what failed, each named as MCP names it, by its
nearest class in Pharo's own packages or MCP's.
Given the path of a file, it writes there what named them, MCP's version
and the image's, on a first line that starts with #, then the names, one a
line, sorted, and answers how many it wrote. scripts/exception-names.js
evaluates it in an image of each Pharo version."
[ :path |
	| backend roots names |
	backend := MCPOpenTelemetryObservabilityBackend basicNew.
	(backend reportableClassNameOf: Exception) = 'Exception' ifFalse: [
		Error signal: 'MCP takes Exception for a class of no package of Pharo''s: this image has no baselines of Pharo''s.' ].
	roots := { Exception } , (#( #OCNotice #RBNotice ) collect: [ :each | Smalltalk globals at: each ifAbsent: [ nil ] ] thenSelect: [ :each | each isNotNil ]).
	names := Set new.
	roots do: [ :root |
		root withAllSubclassesDo: [ :each |
			[ names add: (backend reportableClassNameOf: each) ] on: Error do: [ :error | error return: nil ] ] ].
	names remove: '_OTHER' ifAbsent: [  ].
	path asFileReference
		ensureDelete;
		writeStreamDo: [ :stream |
			stream nextPutAll: '# MCP '; nextPutAll: MCP version; nextPutAll: ' in '; nextPutAll: SystemVersion current imageVersionString; lf.
			names asSortedCollection do: [ :each | stream nextPutAll: each; lf ] ].
	names size ]
