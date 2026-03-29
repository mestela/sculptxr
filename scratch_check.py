import sys, re

with open("src/editing/VoxelState.js", "r") as f:
    text = f.read()

# Make a copy for structural matching
code = text

code = re.sub(r"//.*", "", code)
code = re.sub(r"/\*.*?\*/", "", code, flags=re.DOTALL)
code = re.sub(r"\"(?:[^\\]|\\.)*?\"", "", code)
code = re.sub(r"\'(?:[^\\]|\\.)*?\'", "", code)
code = re.sub(r"\`(?:[^\\]|\\.)*?\`", "", code, flags=re.DOTALL)

stack = []
lines = code.split("\n")
pairs = {")": "(", "}": "{", "]": "["}

for lno, line in enumerate(lines, 1):
    for cno, c in enumerate(line, 1):
        if c in "({[":
            stack.append((c, lno, cno))
        elif c in ")}]":
            if not stack:
                print(f"Unmatched {c} at line {lno}:{cno}")
                sys.exit(1)
            top = stack[-1]
            if top[0] != pairs[c]:
                print(f"Mismatched {c} at line {lno}:{cno}, expecting {pairs[c]}, but got {top[0]} from {top[1]}:{top[2]}")
                sys.exit(1)
            stack.pop()

if stack:
    top = stack[-1]
    print(f"Unclosed {top[0]} from line {top[1]}:{top[2]}")
    sys.exit(1)

print("Syntax checked OK!")
