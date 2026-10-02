from app.duplicate_matching import jaro_winkler

first_score = jaro_winkler("monica", "josh") * 30.0
last_score = jaro_winkler("belluci", "kennedy") * 35.0
print(f"First: {first_score}, Last: {last_score}, Loc: 25.0, Email: 0")
print(f"Total: {first_score + last_score + 25.0}")

first_score_old = jaro_winkler("monica", "josh") * 25.0
last_score_old = jaro_winkler("belluci", "kennedy") * 30.0
print(f"Old First: {first_score_old}, Old Last: {last_score_old}, Loc: 20.0, Email: 0")
print(f"Old Total: {first_score_old + last_score_old + 20.0}")
