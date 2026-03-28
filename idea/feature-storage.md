After annotation of a plasmid or importing a gbk with feature,

Store feature name, sequence, and its host vector in sql.

Add a function to search for feature then trace back to host vector.
# Feature Storage and Traceability Idea

## Goal
After a plasmid is annotated, or after a GenBank (`.gbk`) file with feature annotations is imported, store each feature in a searchable SQL-backed table.

The purpose is to make individual features reusable and traceable across constructs.

## Core concept
For every annotated feature, store at least:
- feature name
- feature sequence
- host vector or parent plasmid identifier

This creates a feature-level index that is separate from the full plasmid record but still linked back to it.

## Required behavior

### 1. Store feature records after annotation or import
Whenever a plasmid is:
- annotated inside the app, or
- imported from a GenBank file that already contains features,

extract the feature information and write it into SQL.

Each stored feature record should remain linked to its source vector.

- deduplicate identical features across multiple vectors

### 2. Support feature search
Add a search function that allows users to search for stored features by:
- feature name
- sequence
- partial sequence
- optionally feature type in the future

### 3. Trace feature back to host vector
When a feature is found in search results, the system should allow the user to trace it back to the plasmid or vector where it came from.

This should make it easy to answer questions such as:
- Which plasmid contains this promoter?
- Where has this tag been used before?
- Which vector did this CDS or origin come from?

## Suggested stored fields
Possible SQL fields for each feature record:
- feature id
- feature name
- feature type
- feature sequence
- sequence length
- strand or direction
- start position
- end position
- host vector id
- host vector name
- source file or annotation source
- created time
- updated time

## Benefits
- fast feature-level search across many plasmids
- reuse of existing annotated parts
- easier construct comparison
- better traceability from part to full vector
- foundation for future part libraries or cloning suggestions

## Future extensions
Possible future improvements:
- deduplicate identical features across multiple vectors
- cluster similar feature variants
- support feature usage statistics
- enable feature-based plasmid recommendation
- add direct jump from feature search result to plasmid map view