import pandas as pd
a = pd.read_csv('public/tags-2025-11-03.csv')
a[(a['post_count'] > 100) | ((a['post_count'] > 10) & a['category'].isin([1])) | ((a['post_count'] > 0) & a['category'].isin([3,4]))].groupby('name').agg('first')['post_count'].to_json('public/tags-2025-11-03.json')
