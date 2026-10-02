from app.duplicate_matching import jaro_winkler

f1 = "monica"
f2 = "joshua"
l1 = "belluci"
l2 = "kennedy"

fs = jaro_winkler(f1, f2) * 30.0
ls = jaro_winkler(l1, l2) * 35.0

print(f"First: {fs}")
print(f"Last: {ls}")
print(f"Total: {fs + ls + 25.0}")
