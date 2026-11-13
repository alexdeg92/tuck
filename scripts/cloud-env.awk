# Read only deployment selectors. Never evaluate dotenv as shell or expand variables.
BEGIN { value = "__UNSET__" }
{
  sub(/\r$/, "")
  line = $0
  sub(/^[ \t]*(export[ \t]+)?/, "", line)
  if (line !~ ("^" key "[ \t]*=")) next
  sub(/^[^=]*=[ \t]*/, "", line)
  sub(/[ \t]+$/, "", line)
  if (line ~ /^["\047]/) {
    quote = substr(line, 1, 1)
    line = substr(line, 2)
    end = index(line, quote)
    if (!end || substr(line, end + 1) !~ /^[ \t]*(#.*)?$/) exit 2
    line = substr(line, 1, end - 1)
  } else {
    sub(/[ \t]+#.*/, "", line)
    sub(/[ \t]+$/, "", line)
  }
  if (line == "__UNSET__") exit 2
  value = line
}
END { print value }
