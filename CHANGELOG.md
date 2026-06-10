# CHANGELOG

## 0.6.x
- The default merging behavior of `left !== right` is abortion the merging, instead of throwing

## 0.5.x
- `writeNodeListWithNewLineSep` also preserve trailing whitespaces of node list if possible

## 0.4.x
- `writeNodeListWithNewLineSep` now preserve leading whitespaces of node list if possible

## 0.3.x
- `writeNodeListWithSourceGaps` removed, use `writeNodeListWithNewLineSep` instead

## 0.2.x
- Remove exposed `defaultGetMappingData` API
- The default mapping data now gets `undefined`
- The default merging behavior now throws when `left !== right`

## 0.1.x

Initial release
