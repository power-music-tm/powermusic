from app.duplicate_matching import match_classification
from app.schemas import PersonInfo

print(match_classification(
    PersonInfo(firstName="Monica", lastName="Belluci", email="nabeeha529@gmail.com", location="Indiana"),
    PersonInfo(firstName="Josh", lastName="Kennedy", email="joshk@gmail.com", location="Indiana")
))
