#!/bin/sh
# Regenera todas as fixtures de referência (backend-ts/test/fixtures) a partir do GrupuxoDomain em Swift.
# Rode a partir de qualquer pasta; precisa do toolchain Swift (macOS).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
out="$here/../../test/fixtures"
for command in dates hungarian engine optimizer scheduling policies fairness; do
  swift run --package-path "$here" swift-fixtures "$command" "$out"
done
