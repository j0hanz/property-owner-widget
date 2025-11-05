# Property Owner Widget

## FBWebb Report URLs

- Configure FBWebb credentials and base URL in the widget settings panel.
- Select at least one property on the map, then use the link button to copy a consolidated report URL.
- If automatic copy fails, the generated URL is shown for manual copy.
- Clipboard actions and configuration changes avoid logging sensitive credentials; only masked values appear in console output.

## Copy Selected Properties

- Use the copy button next to export to copy all selected properties as tab-separated text.
- Copied values respect the PII masking toggle and sanitize HTML before reaching the clipboard.
- Success or failure feedback appears inline so users can retry or fall back to manual copy if needed.
