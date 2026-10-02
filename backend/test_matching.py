from app.duplicate_matching import match_classification
from app.schemas import PersonInfo

print("Scenario A: Exact match")
print(match_classification(
    PersonInfo(firstName="Steven", lastName="Smith", email="steven@example.com", location="Manchester"),
    PersonInfo(firstName="Steven", lastName="Smith", email="steven@example.com", location="Manchester")
))
print("---")

print("Scenario B: Similar first name, same surname/location, different email")
print(match_classification(
    PersonInfo(firstName="Steven", lastName="Smith", email="steven@puregym.com", location="Manchester"),
    PersonInfo(firstName="Steve", lastName="Smith", email="steve@gmail.com", location="Manchester")
))
print("---")

print("Scenario C: Different name, same email + location")
print(match_classification(
    PersonInfo(firstName="John", lastName="Smith", email="john@example.com", location="Manchester"),
    PersonInfo(firstName="David", lastName="Smith", email="john@example.com", location="Manchester")
))
print("---")

print("Scenario D: Same location only")
print(match_classification(
    PersonInfo(firstName="John", lastName="Smith", email="john@example.com", location="Manchester"),
    PersonInfo(firstName="David", lastName="Jones", email="david@example.com", location="Manchester")
))
print("---")

print("Scenario E: Similar name only")
print(match_classification(
    PersonInfo(firstName="Steven", lastName="Smith", email="steven@example.com", location="Manchester"),
    PersonInfo(firstName="Steve", lastName="Smith", email="different@example.com", location="London")
))
print("---")
