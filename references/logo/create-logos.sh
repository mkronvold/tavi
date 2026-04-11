#!/usr/bin/env bash
set -euo pipefail

script_dir="$(
  CDPATH= builtin cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
  command pwd -P
)"
cd -- "${script_dir}"

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf -- "${tmp_dir}"
}
trap cleanup EXIT

convert -background none -density 512 logo.svg -resize 200x200 logo-200.png
convert -background none -density 512 icon-stacked.svg -resize 200x200 icon-200.png

for size in 16 32 48 64; do
  convert icon-200.png -resize "${size}x${size}" "${tmp_dir}/favicon-${size}.png"
done

convert \
  "${tmp_dir}/favicon-16.png" \
  "${tmp_dir}/favicon-32.png" \
  "${tmp_dir}/favicon-48.png" \
  "${tmp_dir}/favicon-64.png" \
  favicon.ico
