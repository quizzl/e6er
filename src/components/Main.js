import { h, Component, createRef } from 'preact';
// import Map from 'es6-map';
import { startWith, mergeMap, finalize } from 'rxjs/operators';
import { EMPTY, from, zip } from 'rxjs'
import { Map, List, Set } from 'immutable'

const GENERIC_TAG_TYPES = new List(['general','species', 'invalid']);
const NAMED_TAG_TYPES = new List(['artist', 'contributor', 'copyright', 'character'])
const MIN_GUESS_LENGTH_NAMED_TAG = 3;

const N_AVG_CENSORED = 8 // average count for tags with post count between 1 and 100 incl is 8.43
const count2score = (count) => Math.sqrt(6E6 / (count === undefined ? 1 / N_AVG_CENSORED : count)) // 6M posts is estimate as of ~Nov 2025
const si_postfixer = (n) => {
	const [post, divider] = new List([['M', 1E6], ['k', 1E3], ['', 1]]).filter(([_, min]) => n >= min).first()
	return `${parseInt(n / divider)}${post}`;
}


export default class Main extends Component {
	state = {
		ALL_TAGS: null, // Map<(tag: string), (post_count: int)> 
		ALL_ALIASES: null, // Map<(tag_ante: string), (tag_cons: string)>
		cur_post_idx: null,
		posts: new List(), /*
			List<TPost>
			TPost := {
				url: string,
				tags: Map<(category: string), List<(tag: string)>>,
				guesses: List<(tag: string, matched: bool)>
				start_time: ?number
			}

		*/
		blacklist: '', // string
		whitelist: '', // string
		guessing_time: 30,
		timer_interval: null, // TimerInterval
		image_loaded: false, // bool
		image_show: false,
		n_showed: 0,
		guess: '', // string
	};
	constructor(props) {
		super(props);
	}

	componentDidMount() {
		Promise.all([
			fetch('tags-2025-11-03.json').then(r => r.json())
				.then(tags => this.setState({ ALL_TAGS: new Map(tags) })),
			fetch('tag_aliases-2025-11-06.json').then(r => r.json())
				.then(implications=> this.setState({ ALL_ALIASES: new Map(implications) })),
		]).then(this.pull_next_post);
	}
	
	pull_next_post = () => {
		return fetch(`https://e621.net/posts.json?limit=1&tags=id:4426599 ${this.state.whitelist} ${this.state.blacklist.split(' ').map(a => '-' + a).join(' ')} score:>100 order:random`) 
			.then(r => r.json())
			.then(({ posts: ps }) => 
				this.setState(state => ({
					cur_post_idx: state.posts.count(), // current post size before append
					posts: state.posts.push({
						url: ps[0].file.url, // TODO: error handling on no files
						tags: (GENERIC_TAG_TYPES.concat(NAMED_TAG_TYPES)).reduce((agg, tag_type) => agg.set(tag_type, new List(ps[0].tags[tag_type])), new Map()),
						guesses: new List(),
						image_loaded: false,
						start_time: null,
					}),
				}))
			, e => console.error('pull_next_post', e)) // TODO: make this retry
	}

	render_tag_list = (guesses, props = {}) => 
		<ul {...props}>
			{guesses.map(([tag, matched]) => {
				const post_count = this.state.ALL_TAGS.get(tag);
				return <li><span>{tag}</span><span>{matched ? `+${parseInt(count2score(post_count))} (${si_postfixer(post_count || N_AVG_CENSORED)})` : null}</span></li>;
			}).toArray()}
		</ul>;
	

	componentDidUpdate(_prevProps, prevState) {
		if(this.state.image_show && !prevState.image_show) {
			setTimeout(t => {
				this.setState({ image_show: false })
			}, 100); // TODO: understand why requestAnimationFrame doesn't work here. May need to tune to work for most browers, or do a Promise.all between them
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

		this.setState(({ guess:guess_raw, last_started }) => {
			const cur_post = this.state.posts.get(this.state.cur_post_idx);

			const guesses = List([guess_raw]).concat(this.state.ALL_ALIASES.get(guess_raw)).filter(a => a !== undefined)
			const matches_generic = GENERIC_TAG_TYPES.reduce((agg, tag_type) => agg.concat(guesses.filter(guess => cur_post.tags.get(tag_type).includes(guess))), new List());
			const matches_named = NAMED_TAG_TYPES.reduce((agg, tag_type) => agg.concat(cur_post.tags.get(tag_type).filter(tag => guess_raw.length > MIN_GUESS_LENGTH_NAMED_TAG && tag.indexOf(guess_raw) !== -1)), new List()) // matches_named only uses raw guess, not the aliased tags (to avoid unexpected false positives)
			const all_matches = matches_generic.concat(matches_named);

			return {
				cur_post: Object.assign(cur_post, {
					guesses: all_matches.isEmpty()
						? cur_post.guesses.push([guess_raw, false])
						: cur_post.guesses.concat(all_matches.map(guess => [guess, true]))
				}),
				guess: '',
			};
		});
	}

	handleGuessChange = e => this.setState({ guess: e.target.value })

	handleClickNext = e => this.pull_next_post()

	handlePostClick = i => {
		this.setState({ cur_post_idx: i })
	}
	handleBlacklistUpdate = e => this.setState({ blacklist: e.target.value })
	handleWhitelistUpdate = e => this.setState({ whitelist: e.target.value })

	render = () => {
		if(this.state.cur_post_idx === null) {
		}
		else {
			const cur_post = this.state.posts.get(this.state.cur_post_idx);
			const cur_time_expired = Date.now() - cur_post.start_time > this.state.guessing_time * 1000;
			return <div id="main_root">
				<section id="main_pane" className={cur_post.start_time === null ? 'unstarted' : (this.state.image_show ? 'ongoing_show' : !cur_time_expired ? 'ongoing_hide' : 'finished')}>
					<section id="controls">
						<input type="button" disabled={!this.state.image_loaded || cur_post.start_time !== null && cur_time_expired } onClick={this.onStartClickHandler} value="Start" />
						<input type="button" onClick={this.handleClickNext} value="Next" />

						<form action="." onSubmit={this.handleGuessSubmit}>
							<input type="text" id="guess_input" onChange={this.handleGuessChange} value={this.state.guess} /><input type="submit" disabled={cur_post.start_time === null || cur_time_expired } />
						</form>
					</section>
					<section id="play_area">
						<p id="main_image_container">
							<img id="main_image_shadow" src={cur_post.url} onLoad={this.onMainImageLoadHandler} />
							<div id="main_image" style={{ 'background-image': `url(${cur_post.url})` }} />
						</p>
						<p id="main_taglist_container">
							{ this.render_tag_list(cur_post.guesses, { id: 'main_taglist' }) }
						</p>
					</section>
				</section>
				<nav id="main_nav">
					<section id="taglists">
						<input placeholder="Whitelist" name="whitelist" id="whitelist" onChange={this.handleWhitelacklistUpdate} />
						<input placeholder="Blacklist" name="blacklist" id="blacklist" onChange={this.handleBlacklistUpdate} />
					</section>
					<section id="posts">
						<ul>
							{ /* console.log(this.get_post_scores().last()[1].toArray()) || */ this.state.posts.map(({ url, guesses, start_time }, post_i) =>
								<li key={post_i} onClick={() => this.handlePostClick(post_i)}>
									{ <img src={url} className={start_time === null || Date.now() - start_time < this.state.guessing_time * 1000 ? 'hidden' : ''} width="50" /> }
									{ this.render_tag_list(guesses) }
								</li>
							).toArray() }
						</ul>
					</section>
				</nav>
			</div>
		}
	}
}
