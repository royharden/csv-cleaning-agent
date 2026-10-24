# Known design limitations

The CSV is re-serialized on export. Original quoting and arbitrary mixed record terminators are not preserved: record terminators outside quoted fields normalize to the detected majority terminator. Embedded cell newlines remain cell content. Byte-exact recovery is available through the retained original blob.

The fixed operation vocabulary cannot repair arbitrary prose, cross-column swaps or ambiguous semantics. Model profiles disclose at most eight screened values per included column, which limits category coverage. Synthetic fixtures are not evidence of live model quality. No dependency installation, generated corpus, evaluation, build, provider call or test has run during Dirty Mode construction.

<!-- generated-by-eval:below -->

Evaluation has not yet run. There are no measured results.
