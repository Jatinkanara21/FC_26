import pandas as pd
from sklearn.ensemble import RandomForestClassifier

df = pd.read_csv("data/fc24_players.csv", low_memory=False)
df = df[df.fifa_version == 24].drop_duplicates("player_id")
pos = {"ST":"FWD","CF":"FWD","LW":"FWD","RW":"FWD","CM":"MID","CDM":"MID","CAM":"MID","LM":"MID","RM":"MID",
       "CB":"DEF","LB":"DEF","RB":"DEF","LWB":"DEF","RWB":"DEF"}
df["group"] = df.player_positions.str.split(",").str[0].map(pos)
df = df.dropna(subset=["group"])
f = ["pace","shooting","passing","dribbling","defending","physic"]
model = RandomForestClassifier(random_state=42).fit(df[f], df.group)

name = input("Player name: ")
found = df[df.long_name.str.contains(name, case=False) | df.short_name.str.contains(name, case=False)]
if found.empty:
    print("Player not found")
else:
    p = found.sort_values("overall").iloc[-1]
    print(p.long_name, "| Real:", p.player_positions, "| Predicted:", model.predict(df.loc[[p.name], f])[0])
