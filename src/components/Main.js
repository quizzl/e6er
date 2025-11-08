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
		posts: new List(), /*
			List<{
				url: string, tags: Map<(category: string), List<(tag: string)>>, guesses: List<(tag: string, matched: bool)>
			}>
			note tags is cached from single lookup on ALL_TAGS per fetch
		*/
		blacklist: new List(), /* List<tag: string> */
		timer_interval: null, // TimerInterval
		image_loaded: false, // bool
		image_show: false,
		last_started: 0,
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
		]).then(this.pull_image);
	}
	
	pull_image = () => {
		return fetch(`https://e621.net/posts.json?limit=1&tags=id:4426599 score:>100 order:random`) // TODO: replace with fast query of max ID
			.then(r => r.json())
			.then(({ posts: ps }) => 
				this.setState(state => ({
					posts: state.posts.push({
						url: ps[0].file.url, // TODO: error handling on no files
						tags: (GENERIC_TAG_TYPES.concat(NAMED_TAG_TYPES)).reduce((agg, tag_type) => agg.set(tag_type, new List(ps[0].tags[tag_type])), new Map()), // TODO: convert to mapMaybe
						guesses: new List(),
						image_loaded: false,
					}),
				}))
			, e => console.error('pull_image', e)) // TODO: make this retry
	}

	componentDidUpdate(_prevProps, prevState) {
		if(this.state.image_show && !prevState.image_show) {
			setTimeout(t => {
				this.setState({ image_show: false })
			}, 100); // TODO: understand why requestAnimationFrame doesn't work here. May need to tune to work for most browers, or do a Promise.all between them
		}
		else if(!this.state.image_show && prevState.image_show) {
			this.pull_image();
		}
	}

	onStartClickHandler = () => {
		const last_started = this.state.posts.count() - 1; 
		this.setState({ image_show: true, last_started });
	}

	onMainImageLoadHandler = () => this.setState({ image_loaded: true })


	handleGuessSubmit = e => {

		e.stopPropagation();
		e.preventDefault();

		this.setState(({ posts, guess:guess_raw, last_started }) => {
			const guesses = List([guess_raw]).concat(this.state.ALL_ALIASES.get(guess_raw)).filter(a => a !== undefined)
			const cur_post = posts.get(last_started);
			const matches_generic = GENERIC_TAG_TYPES.reduce((agg, tag_type) => agg.concat(guesses.filter(guess => cur_post.tags.get(tag_type).includes(guess))), new List());
			const matches_named = NAMED_TAG_TYPES.reduce((agg, tag_type) => agg.concat(cur_post.tags.get(tag_type).filter(tag => guess_raw.length > MIN_GUESS_LENGTH_NAMED_TAG && tag.indexOf(guess_raw) !== -1)), new List()) // matches_named only uses raw guess, not the aliased tags (to avoid unexpected false positives)
			const all_matches = matches_generic.concat(matches_named);

			return {
				posts: posts.set(last_started, Object.assign(cur_post, {
					guesses: all_matches.isEmpty()
						? cur_post.guesses.push([guess_raw, false])
						: cur_post.guesses.concat(all_matches.map(guess => [guess, true]))
				})),
				guess: '',
			};
		});
	}

	handleGuessChange = e => this.setState({ guess: e.target.value })

	render = () => {
		if(this.state.posts.isEmpty()) {
		}
		else {
			const cur_post = this.state.posts.last();
			return <div id="main_root">
				<section id="main_image_container">
					<img id="main_image" src={cur_post.url} onLoad={this.onMainImageLoadHandler} className={this.state.image_show ? "" : "hidden" } />
				</section>
				<input type="button" disabled={!this.state.image_loaded} onClick={this.onStartClickHandler} value="Start" />
				<section id="taglist">
					<form action="." onSubmit={this.handleGuessSubmit}>
						<input type="text" onChange={this.handleGuessChange} value={this.state.guess} /><input type="submit" />
					</form>
					{ /* console.log(this.get_post_scores().last()[1].toArray()) || */ this.state.posts.map(({ url, guesses }, post_i) =>
						<p index={post_i}>
							{ post_i >= this.state.last_started ? null : <img src={url} width="50" /> }
							<ul index={post_i}>
								{guesses.map(([tag, matched]) => {
									const post_count = this.state.ALL_TAGS.get(tag);
									return <li><span>{tag}</span><span>{matched ? `+${parseInt(count2score(post_count))} (${si_postfixer(post_count || N_AVG_CENSORED)})` : null}</span></li>;
								}).toArray()}
							</ul>
						</p>
					).toArray() }
				</section>
			</div>
		}
	}
}
