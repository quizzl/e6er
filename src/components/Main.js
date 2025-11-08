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
		prev_posts: new List(), /*
			List<TPost>
		*/
		cur_post: null, /* ?TPost := {
				url: string, tags: Map<(category: string), List<(tag: string)>>, guesses: List<(tag: string, matched: bool)>
			} */
		blacklist: new List(), /* List<tag: string> */
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
		]).then(this.pull_image);
	}
	
	pull_image = () => {
		return fetch(`https://e621.net/posts.json?limit=1&tags=id:4426599 score:>100 order:random`) // TODO: replace with fast query of max ID
			.then(r => r.json())
			.then(({ posts: ps }) => 
				this.setState(state => ({
					cur_post: {
						url: ps[0].file.url, // TODO: error handling on no files
						tags: (GENERIC_TAG_TYPES.concat(NAMED_TAG_TYPES)).reduce((agg, tag_type) => agg.set(tag_type, new List(ps[0].tags[tag_type])), new Map()), // TODO: convert to mapMaybe
						guesses: new List(),
						image_loaded: false,
					},
				}))
			, e => console.error('pull_image', e)) // TODO: make this retry
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
		else if(!this.state.image_show && prevState.image_show) {
			this.pull_image();
		}
	}

	onStartClickHandler = () => {
		this.setState(state => ({ image_show: true, n_showed: state.n_showed + 1 }));
	}

	onMainImageLoadHandler = () => this.setState({ image_loaded: true })


	handleGuessSubmit = e => {

		e.stopPropagation();
		e.preventDefault();

		this.setState(({ cur_post, guess:guess_raw, last_started }) => {
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

	render = () => {
		if(this.state.cur_post === null) {
		}
		else {
			return <div id="main_root">
				<section id="main_image_container">
					<img id="main_image" src={this.state.cur_post.url} onLoad={this.onMainImageLoadHandler} className={this.state.image_show ? "" : "hidden" } />
				</section>
				<input type="button" disabled={!this.state.image_loaded} onClick={this.onStartClickHandler} value="Start" />
				<section id="taglist">
					<form action="." onSubmit={this.handleGuessSubmit}>
						<input type="text" onChange={this.handleGuessChange} value={this.state.guess} /><input type="submit" />
					</form>
					{ this.render_tag_list(this.state.cur_post.guesses) }
				</section>
				<section id="prev_posts">
					{ /* console.log(this.get_post_scores().last()[1].toArray()) || */ this.state.prev_posts.map(({ url, guesses }, post_i) =>
						<p key={post_i}>
							{ <img src={url} width="50" /> }
							{ this.render_tag_list(guesses) }
						</p>
					).toArray() }
				</section>
			</div>
		}
	}
}
