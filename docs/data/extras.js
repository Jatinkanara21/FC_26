window.FC24_EXTRAS = {
 "model_exported": "2026-10-28 14:10 UTC",
 "simple_map": {
  "groups": {
   "shooting": [
    "attacking_finishing",
    "power_shot_power",
    "power_long_shots",
    "attacking_volleys",
    "mentality_penalties",
    "mentality_positioning"
   ],
   "dribbling": [
    "skill_dribbling"
   ],
   "passing": [
    "mentality_vision"
   ],
   "defending": [
    "defending_sliding_tackle",
    "defending_standing_tackle",
    "defending_marking_awareness",
    "mentality_interceptions"
   ]
  },
  "coef": {
   "attacking_finishing": [
    -7.7989,
    1.1143
   ],
   "power_shot_power": [
    15.9183,
    0.8195
   ],
   "power_long_shots": [
    -3.8154,
    1.0448
   ],
   "attacking_volleys": [
    -1.2299,
    0.9062
   ],
   "mentality_penalties": [
    13.6762,
    0.7194
   ],
   "mentality_positioning": [
    9.2922,
    0.881
   ],
   "skill_dribbling": [
    -13.1053,
    1.1848
   ],
   "mentality_vision": [
    -8.2661,
    1.1199
   ],
   "defending_sliding_tackle": [
    -6.0305,
    1.0842
   ],
   "defending_standing_tackle": [
    -4.5167,
    1.1024
   ],
   "defending_marking_awareness": [
    -4.0633,
    1.0556
   ],
   "mentality_interceptions": [
    -6.5661,
    1.104
   ]
  },
  "range": [
   10,
   99
  ],
  "unused": {
   "pace": "Speed",
   "physic": "Strength"
  },
  "note": "detailed rating = round(a + b * slider), least-squares fit on all outfield players"
 },
 "dataset": {
  "file": "fc24_players.csv",
  "rows_file": 18350,
  "rows_fc24": 18350,
  "goalkeepers_removed": 2045,
  "rows_outfield": 16305,
  "columns_file": 109,
  "missing_by_column": {
   "nation_team_id": 17570,
   "nation_position": 17570,
   "nation_jersey_number": 17570,
   "club_loaned_from": 17170,
   "player_tags": 17098,
   "goalkeeping_speed": 16305,
   "player_traits": 9741,
   "shooting": 2045,
   "passing": 2045,
   "physic": 2045,
   "dribbling": 2045,
   "defending": 2045,
   "pace": 2045,
   "release_clause_eur": 1280,
   "club_joined_date": 1267,
   "value_eur": 100,
   "wage_eur": 87,
   "club_jersey_number": 87,
   "club_position": 87,
   "league_level": 87,
   "league_name": 87,
   "league_id": 87,
   "club_name": 87,
   "club_team_id": 87,
   "club_contract_valid_until_year": 87
  },
  "missing_cells": 128724,
  "missing_model_columns_outfield": {
   "defending_sliding_tackle": 0,
   "defending_standing_tackle": 0,
   "attacking_finishing": 0,
   "defending": 0,
   "defending_marking_awareness": 0,
   "mentality_interceptions": 0,
   "shooting": 0,
   "attacking_volleys": 0,
   "power_long_shots": 0,
   "mentality_penalties": 0,
   "mentality_positioning": 0,
   "mentality_vision": 0,
   "power_shot_power": 0,
   "skill_dribbling": 0,
   "dribbling": 0
  },
  "class_counts": {
   "MID": 6673,
   "DEF": 6174,
   "FWD": 3458
  }
 }
};
