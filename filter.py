import pandas as pd
a = pd.read_csv('public/tags-2025-11-03.csv')
b = a[(a['post_count'] > 100)].groupby('name').agg('first')['post_count'] #  | ((a['post_count'] > 10) & a['category'].isin([1])) | ((a['post_count'] > 10) & a['category'].isin([3,4]) # just assume a non-hit is ~33 for power law.
b.to_json('public/tags-2025-11-03.json')
c = pd.read_csv('public/tag_aliases-2025-11-06.csv')
c[['antecedent_name', 'consequent_name']].merge(b, left_on='consequent_name', right_index=True).groupby('antecedent_name').agg('first')['consequent_name'].to_json('public/tag_aliases-2025-11-06.json')
