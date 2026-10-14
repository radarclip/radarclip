# Build, test and check everything. Rust via rustup (~/.cargo/bin), schema check via uv.
CARGO ?= $(shell command -v cargo || echo $(HOME)/.cargo/bin/cargo)

.PHONY: build test spec-check check wasm-check wasm serve js js-test player-serve

build:
	$(CARGO) build --release

test:
	$(CARGO) test --workspace

spec-check:
	uvx -q check-jsonschema --schemafile spec/radarclip-1.schema.json spec/fixtures/*.radarclip.json

# The parser must keep compiling for the browser.
wasm-check:
	$(CARGO) check -p radarclip-wasm --target wasm32-unknown-unknown

WASM_BINDGEN ?= $(shell command -v wasm-bindgen || echo $(HOME)/.cargo/bin/wasm-bindgen)

# Browser build → crates/radarclip-wasm/pkg (needs wasm-bindgen-cli matching the crate's wasm-bindgen).
wasm:
	$(CARGO) build --release --target wasm32-unknown-unknown -p radarclip-wasm
	$(WASM_BINDGEN) --target web --out-dir crates/radarclip-wasm/pkg target/wasm32-unknown-unknown/release/radarclip_wasm.wasm

# Test page: http://localhost:8765/www/
serve: wasm
	python3 -m http.server 8765 -d crates/radarclip-wasm

# TypeScript packages (pnpm workspace).
js:
	pnpm install --frozen-lockfile
	pnpm build

js-test: js
	pnpm test
	pnpm typecheck

# Player test page: http://localhost:8766/packages/player/www/ (radars: node packages/player/scripts/local-radars.mjs <dir>)
player-serve: js
	python3 -m http.server 8766 -b 127.0.0.1

check: test spec-check wasm-check js-test
