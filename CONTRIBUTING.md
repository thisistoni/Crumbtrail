# Contributing to Crumbtrail

Thanks for helping make process documentation less painful.

## Setup

Install Node.js 20+, pnpm, Rust stable MSVC, Visual Studio Build Tools with the Desktop C++ workload, and WebView2. Then run:

```powershell
pnpm install
pnpm dev
```

Run the desktop application with `pnpm tauri dev`.

## Checks

Before opening a pull request:

```powershell
pnpm lint
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

Keep platform APIs behind `CaptureBackend`. Never add logging that includes key codes, entered text, screenshot pixels, file contents, or accessibility-derived values. New archive inputs must remain size- and path-validated.

## Pull requests

Keep changes focused, describe user-visible behavior, add tests for data-model or privacy-sensitive changes, and include manual Windows verification notes when capture behavior changes. Contributions are accepted under MIT OR Apache-2.0.
