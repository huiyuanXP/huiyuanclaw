# Issue Taxonomy

Read this at the start of a dogfood run to calibrate severity, categories, and coverage.

## Severity Levels

| Severity | Definition |
|----------|------------|
| `critical` | Blocks a core workflow, causes data loss, or crashes the app |
| `high` | Major feature broken or unusable, no reasonable workaround |
| `medium` | Feature works but with noticeable defects or friction |
| `low` | Cosmetic or polish issue with limited impact |

## Categories

### Visual / UI

- Misalignment, overlap, clipping, broken icons
- Theme regressions and poor responsive behavior
- Animation glitches, z-index issues, or unreadable contrast

### Functional

- Buttons or links that do nothing
- Incorrect navigation, broken forms, stale state, failed uploads/downloads
- Task/session actions that silently fail

### UX

- Missing loading or error feedback
- Confusing navigation or dead ends
- Missing confirmations for destructive actions

### Content

- Typos, placeholder text, incorrect labels, inconsistent terminology

### Performance

- Slow page load, janky scrolling, large layout shifts, excessive requests

### Console / Errors

- JavaScript exceptions
- Failed network requests
- Unhandled promise rejections

### Accessibility

- Missing labels or alt text
- Broken keyboard navigation or focus handling
- Insufficient color contrast

## Exploration Checklist

1. Take an initial annotated screenshot.
2. Click the main navigation and core actions.
3. Test empty, loading, error, and success states.
4. Check console and network failures periodically.
5. Re-test the most important issue once before documenting it as a confirmed finding.
