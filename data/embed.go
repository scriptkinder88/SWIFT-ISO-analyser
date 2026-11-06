// Package data embeds the default framework and the sample architecture so the
// binary runs without any external file.
package data

import _ "embed"

//go:embed swift-cscf.json
var SwiftCSCF []byte

//go:embed sample-architecture.json
var SampleArchitecture []byte
