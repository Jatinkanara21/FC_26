
## Updated evaluation note (28 October 2026)
The repository training script now splits the dataset before fitting preprocessing and feature selection. The seven Random Forest configurations are compared with 3-fold stratified cross-validation on the training split; each CV fold fits its own median imputer and SelectKBest selector. The held-out test split is used only for final reported metrics. The selected 200-tree model reports test accuracy 0.8185, macro F1 0.8152 and macro AUC 0.9466. These values were regenerated from the included dataset; do not quote older notebook numbers if they differ.

**Security viva note:** the browser-only admin panel is a local college-demo feature, not secure authentication. No default password is shipped. Configure a hash for demo use, and use server-side auth plus a database for production. Streamlit requires `st.secrets["ADMIN_PASSWORD"]` and has no hard-coded fallback.

# P11 · FC 24 Position Finder: Viva questions and answers

KANARA JATIN JIJI · F10 · Div E · Enrollment 24004501210126
All numbers are from my own run of `F10_P11_Jatin.ipynb` (Random Forest, SelectKBest k = 15, test set = 3,261 players).

**1. What is bagging?**
Bagging = **B**ootstrap **agg**regat**ing**. Each tree is trained on a random sample of the training players drawn *with replacement* (some players repeat, some are left out). Then all trees vote and the majority class is the answer. Random Forest = bagging of decision trees + a random subset of features at each split.

**2. Why is a forest more stable than one decision tree?**
One tree changes a lot when the data changes a little (high variance) and overfits. Each tree in a forest sees different data, so the trees make different mistakes, and when they vote the mistakes cancel out.
In my project one tree alone scored macro F1 **0.710 to 0.743** (average 0.729); the forest of the same 100 trees scored **0.811**.

**3. What does n_estimators change?**
It is the number of trees. More trees = more votes = a steadier result, but slower training. It does not cause overfitting.
Mine: 50 trees → F1 0.808, 100 → 0.811, **200 → 0.815 (best)**. The gain gets smaller as trees are added.

**4. Why does each tree see a random subset of features?**
So the trees are different from each other. Otherwise every tree would split first on the strongest feature (`attack_defence_gap`), all trees would look the same and make the same mistakes. Different trees = errors that cancel in the vote.

**5. Which 5 features were most important and why?** (100-tree forest, Step 10)
1. `attack_defence_gap` **0.138**, my new feature = (shooting + dribbling)/2 − defending. Average FWD +33.2, MID +10.2, DEF −14.8.
2. `defending_sliding_tackle` **0.106**: defenders slide-tackle, forwards almost never.
3. `attacking_finishing` **0.100**: scoring is a forward's main job.
4. `mentality_vision` **0.085**: seeing the key pass is a midfielder's skill, so it picks out MID.
5. `defending_marking_awareness` **0.070**: staying close to an opponent is a defender's skill.
So the model asks "better at attacking or defending, and can he create?", like a coach.

**6. Can Random Forest overfit?**
Yes, a little. Each deep tree overfits the training data (train accuracy is about 1.0), but averaging many trees reduces it. More trees do not overfit. Trees that are too shallow underfit: my max_depth = 5 gave only F1 **0.781**, while None gave 0.811 and 10 gave 0.810. The test score (unseen players) stays high, 0.815, so the forest generalises.

**7. Why is F1 the most important metric in MY project?**
The classes are imbalanced: MID 40.9%, DEF 37.9%, FWD only 21.2%. Accuracy can look good even if FWD is often missed. **Macro F1** averages the F1 of each class equally, so FWD counts as much as MID and DEF, and F1 balances precision and recall. My final macro F1 = **0.815**.

**8. What is precision, recall and specificity? Explain with your confusion matrix.**
Final model (rows = actual, columns = predicted, order DEF / FWD / MID):

| | pred DEF | pred FWD | pred MID |
|---|---|---|---|
| **true DEF** | 1090 | 0 | 145 |
| **true FWD** | 0 | 534 | 158 |
| **true MID** | 164 | 125 | 1045 |

For **FWD**: TP = 534, FP = 125 (midfielders called FWD), FN = 158 (forwards called MID), TN = 2,444.
- **Precision** = TP / (TP + FP) = 534 / 659 = **0.810**: when the model says FWD, it is right 81% of the time.
- **Recall** = TP / (TP + FN) = 534 / 692 = **0.772**: it finds 77% of real forwards.
- **Specificity** = TN / (TN + FP) = 2,444 / 2,569 = **0.951**: 95% of non-forwards are correctly not called FWD.
DEF is easiest (recall 0.883); MID has the lowest precision (0.775) because midfielders sit between attack and defence. No defender was ever called a forward and no forward a defender.

**9. What does AUC = 0.5 and AUC = 1.0 mean?**
AUC = 0.5: the model ranks players no better than a coin toss (the diagonal line on the ROC chart). AUC = 1.0: it separates the classes perfectly. My macro AUC (one-vs-rest) is **0.947**, close to 1.

**10. Why did you use stratify=y in train_test_split?**
So the train and test sets keep the same class mix as the full data. Both have MID 40.9%, DEF 37.9%, FWD 21.2%. Without it, the test set could get too few forwards and the scores would be unfair.

**11. Which columns did you drop or clean, and why?**
- IDs and links (player_id, player_url, club_team_id …): no football meaning.
- Names and text (short_name, long_name, club_name, dob, player_traits …): not skills, too many unique values.
- Same for every row (fifa_version, fifa_update, update_as_of).
- Money / club info (value_eur, wage_eur, release_clause_eur, jersey numbers, contract year): not player attributes.
- **Leakage**: player_positions (the answer itself), club_position, nation_position, overall/potential and the 27 position ratings (st, cm, cb …), which would give a fake almost-100% score.
- goalkeeping_speed: empty for outfield players. Goalkeepers were removed from the target.
- Missing values: median for numbers, mode for text. Duplicates: 0 found.
