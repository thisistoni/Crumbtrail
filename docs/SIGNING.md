# Windows signing

Version `0.1.0` deliberately leaves code signing unset. The generated NSIS installer is per-user and requires no administrator privileges, but Windows SmartScreen may warn because the publisher is unknown.

For a public release:

1. Obtain an Authenticode certificate from a trusted issuer (or use a managed signing service).
2. Keep credentials outside the repository and CI logs.
3. Configure Tauri's Windows signing certificate or a `signCommand` that signs both the application executable and installer.
4. Use an RFC 3161 timestamp service.
5. Verify signatures with `Get-AuthenticodeSignature` and test the installer on a clean Windows 11 VM.

Do not commit a `.pfx`, its password, cloud signing token, or the final signing command with embedded credentials.
