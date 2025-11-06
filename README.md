# Property Owner Widget

## Cursor Management

The widget changes the browser cursor to provide visual feedback when active:

- **CSS Cursor**: Uses `view.container.style.cursor` for reliable cross-browser support
- **Configurable Style**: Choose from standard cursor values in the settings panel (crosshair, pointer, grab, wait, etc.)
- **Custom Cursors**: Supports custom `url()` cursors (e.g., `url(cursor.png), auto`)
- **Automatic Restoration**: Previous cursor is automatically restored when widget deactivates
- **Dual Feedback**: Works alongside existing graphics overlay (crosshair marker + tooltip) for comprehensive visual feedback

### Supported Cursor Values

Standard CSS cursor keywords:

- `auto`, `default`, `crosshair` (default), `pointer`, `move`
- `grab`, `grabbing`, `wait`, `progress`, `not-allowed`
- `help`, `text`, `cell`, `zoom-in`, `zoom-out`
- All standard resize cursors (`n-resize`, `e-resize`, `ne-resize`, etc.)

Custom cursors:

- `url(https://example.com/cursor.png), auto`
- `url(cursor.cur), crosshair`

The widget stores and restores the previous cursor value to avoid interfering with other widgets or map interactions.

## FBWebb Report URLs

- Configure FBWebb credentials and base URL in the widget settings panel.
- Select at least one property on the map, then use the link button to copy a consolidated report URL.
- If automatic copy fails, the generated URL is shown for manual copy.
- Clipboard actions and configuration changes avoid logging sensitive credentials; only masked values appear in console output.

## Copy Selected Properties

- Use the copy button next to export to copy all selected properties as tab-separated text.
- Copied values respect the PII masking toggle and sanitize HTML before reaching the clipboard.
- Success or failure feedback appears inline so users can retry or fall back to manual copy if needed.
