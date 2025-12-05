import { h, Component, createRef } from 'preact';
// import Map from 'es6-map';
import { startWith, mergeMap, finalize } from 'rxjs/operators';
import { EMPTY, from, zip } from 'rxjs'
import { OrderedMap, Map, List, Set } from 'immutable'

const GENERIC_TAG_TYPES = new List(['species', 'general', 'invalid']);
const NAMED_TAG_TYPES = new List(['artist', 'contributor', 'copyright', 'character'])
const MIN_GUESS_LENGTH_NAMED_TAG = 3;

const N_AVG_CENSORED = 8 // average count for tags with post count between 1 and 100 incl is 8.43
const count2score = (count) => Math.pow(Math.log(1E7 / (count === undefined ? N_AVG_CENSORED : count)), 1.4) // 6M posts is estimate as of ~Nov 2025
const si_postfixer = (n) => {
	const [post, divider] = new List([['M', 1E6], ['k', 1E3], ['', 1]]).filter(([_, min]) => n >= min).first()
	return `${parseInt(n / divider)}${post}`;
}


export default class Main extends Component {
	guess_input = null;
	state = {
		ALL_TAGS: null, // Map<(tag: string), (post_count: int)> 
		ALL_ALIASES: null, // Map<(tag_ante: string), (tag_cons: string)>
		cur_post_idx: null,
		posts: new List(), /*
			List<TPost>
			TPost := {
				url: string,
				tags: Map<(category: string), Set<(tag: string)>>,
				guesses: List<(tag: string, matched: bool)>
				start_time: ?number
			}

		*/
		blacklist: '', // string
		whitelist: '', // string
		guessing_time: 20,
		flash_time: 0.3,
		min_score:100,
		timer_interval: null, // TimerInterval
		image_loaded: false, // bool
		image_show: false,
		tick: 0, // int // for triggering re-renders for timer
		guess: '', // string

		error_idx: 0,
		error: '',
	};
	constructor(props) {
		super(props);
	}

	componentDidMount() {
		Promise.all([
			fetch('public/tags-2025-11-03.json').then(r => r.json())
				.then(tags => this.setState({ ALL_TAGS: new Map(tags) })),
			fetch('public/tag_aliases-2025-11-06.json').then(r => r.json())
				.then(implications=> this.setState({ ALL_ALIASES: new Map(implications) })),
		]).then(this.pull_next_post);

		this.state.timer_interval = setInterval(() => this.setState(({tick}) => ({ tick: tick+1 })), 270);
	}
	
	pull_next_post = () => {
		return fetch(`https://e621.net/posts.json?limit=1&tags=${this.state.whitelist} ${this.state.blacklist.split(' ').map(a => '-' + a).join(' ')} score:>${parseInt(this.state.min_score)} order:random`) 
			.then(r => r.json())
			.then(({ posts: ps }) => 
				ps.length === 0 ? this.setState(state => ({ error_idx: state.error_idx + 1, error: 'No posts were found.' }))
					: ps[0].preview.url === null || ps[0].file.url === null
						? this.pull_next_post()
						: this.setState(state => ({
							cur_post_idx: state.posts.count(), // current post size before append
							posts: state.posts.push({
								id: ps[0].id,
								url: [ ps[0].preview.url, ps[0].sample.url || ps[0].file.url ], // TODO: error handling on no files
								tags: (NAMED_TAG_TYPES.concat(GENERIC_TAG_TYPES)).reduce((agg, tag_type) => agg.set(tag_type, new Set(ps[0].tags[tag_type])), new OrderedMap()),
								guesses: new List(),
								image_loaded: false,
								start_time: null,
							}),
				}))
			) //  console.error('pull_next_post', e))
			.catch(e => console.error('pull_next_post', e) || this.setState(state => ({ error_idx: state.error_idx + 1, error: `Oh no big error! Let quizz know @quizzlicks on Telegram with this info: ${e.toString()}` })))
	}

	agg_guess_scores = (guesses) => guesses.reduce((agg, [guess, matched]) => agg + (matched ? Math.ceil(count2score(this.state.ALL_TAGS.get(guess))) : -1), 0)
	render_taglist = (guesses, props = {}) => 
		<ul className="taglist" {...props}>
			{guesses.map(([tag, matched]) => {
				const post_count = this.state.ALL_TAGS.get(tag);
				return <li className={matched ? 'correct' : 'incorrect'}><span className="tag-name">{post_count ? <a href={`https://e621.net/posts?tag=${tag}`} target="_blank">{tag}</a> : tag}</span>{<span><span className="tag-score">+{Math.ceil(count2score(post_count))}</span><span className="tag-post-count">{si_postfixer(post_count || N_AVG_CENSORED)}</span></span>}</li>;
			}).toArray()}
		</ul>;
	

	componentDidUpdate(_prevProps, prevState) {
		if(this.state.image_show && !prevState.image_show) {
			setTimeout(t => {
				this.setState({ image_show: false })
				this.guess_input.focus();
			}, this.state.flash_time * 1000); // TODO: understand why requestAnimationFrame doesn't work here. May need to tune to work for most browers, or do a Promise.all between them
		}
		/* else if(!this.state.image_show && prevState.image_show) {
			this.pull_next_post();
		} */
	}

	onStartClickHandler = () => {
		this.setState(({ posts, cur_post_idx }) => ({ image_show: true, posts: posts.set(cur_post_idx, Object.assign(posts.get(cur_post_idx), { start_time: Date.now() } )) }));
	}

	onMainImageLoadHandler = () => this.setState({ image_loaded: true })


	handleGuessSubmit = e => {

		e.stopPropagation();
		e.preventDefault();

		this.setState(({ guess:guess_raw_, last_started }) => {
			const guess_raw = guess_raw_.toLowerCase();
			const cur_post = this.state.posts.get(this.state.cur_post_idx);

			const guesses = List([guess_raw]).concat(this.state.ALL_ALIASES.get(guess_raw)).filter(a => a !== undefined)
			const matches_generic = GENERIC_TAG_TYPES.reduce((agg, tag_type) => agg.concat(guesses.filter(guess => cur_post.tags.get(tag_type).includes(guess))), new List());
			const matches_named = NAMED_TAG_TYPES.reduce((agg, tag_type) => agg.concat(cur_post.tags.get(tag_type).filter(tag => guess_raw.length >= MIN_GUESS_LENGTH_NAMED_TAG && tag.indexOf(guess_raw) !== -1)), new List()) // matches_named only uses raw guess, not the aliased tags (to avoid unexpected false positives)
			const tag_set = new Set(cur_post.guesses.map(([a, _]) => a));
			const all_matches = matches_generic.concat(matches_named);

			return {
				cur_post: Object.assign(cur_post, {
					guesses: all_matches.isEmpty()
						? ( tag_set.has(guess_raw) ? cur_post.guesses : cur_post.guesses.push([guess_raw, false]))
						: cur_post.guesses.push([
							new Set(all_matches)
								.subtract(tag_set)
								.reduce((a, x) => {
									console.log(a,x);
									const [an, _] = a;
									const n = this.state.ALL_TAGS.get(x) || 0;
									return n > an ? [n, x] : a; // pick only least populated tag
								}, [-Infinity, null])[1],
							true
						])
				}),
				guess: '',
			};
		});
	}

	handleGuessChange = e => this.setState({ guess: e.target.value })

	handleClickNext = e => this.pull_next_post()

	handlePostClick = i => this.setState({ cur_post_idx: i, image_loaded: false })

	handleBlacklistUpdate = e => this.setState({ blacklist: e.target.value })
	handleWhitelistUpdate = e => this.setState({ whitelist: e.target.value })

	handleFlashTimeUpdate = e => this.setState({ flash_time: e.target.value })
	handleMinScoreUpdate = e => this.setState({ min_score: e.target.value })

	render = () => {
		if(this.state.cur_post_idx === null) {
		}
		else {
			const cur_post = this.state.posts.get(this.state.cur_post_idx);
			const cur_guesses = cur_post.guesses.map(([tag, _matched]) => tag);
			const cur_time_expired = Date.now() - cur_post.start_time > this.state.guessing_time * 1000;
			return <div id="main_root">
				<section id="main_pane" className={cur_post.start_time === null ? 'unstarted' : (this.state.image_show ? 'ongoing_show' : !cur_time_expired ? 'ongoing_hide' : 'finished')}>
					<section id="main_controls">
						<section id="main_buttons">
							<input type="range" value={this.state.flash_time} min="0.1" max="1.0" step="0.1" id="flash_time" name="flash_time" onInput={this.handleFlashTimeUpdate} /><label id="flash_time_label" for="flash_time"><b>{this.state.flash_time}sec</b> speed</label>
							<input type="button" disabled={!this.state.image_loaded || cur_post.start_time !== null } onClick={this.onStartClickHandler} value="Start" />
							<input type="button" onClick={this.handleClickNext} value="Next" />
						</section>

						<form action="." onSubmit={this.handleGuessSubmit}>
							<input type="text" id="guess_input" placeholder="Your guess" ref={(input) => this.guess_input = input} onInput={this.handleGuessChange} value={this.state.guess} /><input type="submit" value="+" disabled={cur_post.start_time === null || cur_time_expired } />
						</form>
					</section>
					<section id="play_area">
						<p id="main_taglist_container">
							<div id="main_taglist">{ this.render_taglist(cur_post.guesses, { id: 'main_taglist' }) }</div>
							<div id="round_score" className={`round-score-parity-${cur_post.guesses.count() % 2}-${cur_post.guesses.isEmpty() ? 'start'  : (cur_post.guesses.last()[1] ? 'correct' : 'incorrect') }`}><h3>Round score:</h3>{ this.agg_guess_scores(cur_post.guesses)  }</div>
						</p>
						<p id="main_image_container">
							<p id="actual_taglist">
								{ cur_post.tags.mapKeys((k, tags) =>
									<p id={`missing_sidelist_${k}`}>
										{ tags.isEmpty() ? null : <h3>{k.toUpperCase()}</h3> }
									{ this.render_taglist(tags.toList().sort().map(tag => [tag, cur_guesses.contains(tag)]).sort(), true, { key: k }) }
									</p>
								).toArray() }
							</p>
							<img id="main_image_shadow" src={cur_post.url[0]} onLoad={this.onMainImageLoadHandler} />
							<a target="_blank" href={cur_post.start_time !== null && cur_time_expired ? `https://e621.net/posts/${cur_post.id}` : null } id="main_image" style={{ 'background-image': `url(${cur_time_expired ? cur_post.url[1] : cur_post.url[0]})` }}>
								<span id="main_image_placeholder">
									Press [Start].
								</span>
								<span id="main_timer">
									<h4>Guess tags.</h4>
									<div>{ `${(Math.max(this.state.guessing_time - (Date.now() - cur_post.start_time) / 1000, 0)).toFixed(0)}s` /* sorry "incorrect assumptions about time" */ }</div>
								</span>
							</a>
						</p>
					</section>
				</section>
				<nav id="main_nav">
					<section id="user_taglists">
						<h2>e621 post controls (applied next round)</h2>
						<p id="e6_min_score_holder">
							<input type="range" value={this.state.min_score} min="-100" max="100" step="1" id="min_score" name="min_score" onInput={this.handleMinScoreUpdate} />
							<label id="min_score_label" for="min_score">e621 min score <b>{this.state.min_score}</b>{this.state.min_score < -10 ? " (heh bold today are we...)" : ""}</label>
						</p>
						<input placeholder="Whitelist (e.g. penis fox what_has_science_done)" name="whitelist" id="whitelist" onInput={this.handleWhitelistUpdate} value={this.state.whitelist} />
						<input placeholder="Blacklist (e.g. penis fox what_has_science_done)" name="blacklist" id="blacklist" onInput={this.handleBlacklistUpdate} value={this.state.blacklist} />
					</section>
					<section id="total_score_container">
						<h3 id="total_score">Total score: {this.state.posts.reduce((agg, { guesses }) => agg + this.agg_guess_scores(guesses), 0)}</h3>
					</section>
					<section id="posts">
						<ul id="postlist">
							{ /* console.log(this.get_post_scores().last()[1].toArray()) || */ this.state.posts.map(({ url, guesses, start_time }, post_i) =>
								<li key={post_i} className={post_i === this.state.cur_post_idx ? "selected" : ""} onClick={() => this.handlePostClick(post_i)}>
									{ <img src={start_time === null || Date.now() - start_time < this.state.guessing_time * 1000 ? 'public/img/mystery.png' : url[0]} width="50" /> }
									{ this.render_taglist(guesses) }
								</li>
							).toArray() }
						</ul>
					</section>
					<section id="logo_container">
						<a href="https://github.com/quizzl/e6er.git" target="_blank"><img src="public/img/logo.png" id="logo" /></a>
					</section>
				</nav>
				<section id="error_reporter_container">
					<div id="error_reporter" className={this.state.error_idx > 0 ? `error_parity_${this.state.error_idx % 2}` : ''}>{this.state.error}</div>
				</section>
			</div>
		}
	}
}
