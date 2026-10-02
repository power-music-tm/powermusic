from app.duplicate_matching import match_classification
from app.schemas import PersonInfo

print(match_classification(
    PersonInfo(firstName="monica", lastName="belluci", email="nabeeha529@gmail.com", location="indiana"),
    PersonInfo(firstName="Joshua", lastName="Kennedy", email="jwork@gmail.com", location="Indiana")
))
