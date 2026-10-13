# Build, test and check everything. Rust via rustup (~/.cargo/bin), schema check via uv.
CARGO ?= $(shell command -v cargo || echo $(HOME)/.cargo/bin/cargo)

.PHONY: build test spec-check check wasm-check

build:
	$(CARGO) build --release

test:
	$(CARGO) test --workspace

spec-check:
	uvx -q check-jsonschema --schemafile spec/radarclip-1.schema.json spec/fixtures/*.radarclip.json

# The parser must keep compiling for the browser.
wasm-check:
	$(CARGO) check -p radarclip-core --target wasm32-unknown-unknown

check: test spec-check wasm-check
