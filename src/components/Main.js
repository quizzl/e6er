import { h, Component, createRef } from 'preact';
// import Map from 'es6-map';
import { startWith, mergeMap, finalize } from 'rxjs/operators';
import { EMPTY, from, zip } from 'rxjs'
import { Map, List, Set } from 'immutable'

const TAG_TYPES = new List(['general', 'artist', 'contributor', 'copyright', 'character', 'species', 'invalid']);

export default class Main extends Component {
	state = {
		ALL_TAGS: null, // Map<(tag: string), (post_count: int)> 
		posts: new List(), /*
			List<{
				url: string, tags: Map<(tag: string), (post_count: int)>, guesses: List<tag: string>
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
		fetch('tags-2025-11-03.json').then(r => r.json())
			.then(tags => this.setState({ ALL_TAGS: new Map(tags) }))
			.then(this.pull_image);
	}
	
	pull_image = () => {
		return fetch(`https://e621.net/posts.json?tags=id:${4426599 && parseInt(Math.random() * 6000000)}`) // TODO: replace with fast query of max ID
			.then(r => r.json())
			.then(({ posts: ps }) => 
				ps.length === 0 || ps[0].score.total < 50 // TODO: implement blacklist
					? this.pull_image()
					: this.setState(state => ({
						posts: state.posts.push({
							url: ps[0].file.url, // TODO: error handling on no files
							tags: TAG_TYPES.reduce((agg, tag_type) => agg.merge(new List(ps[0].tags[tag_type]).reduce((subagg, tag) => subagg.set(tag, this.state.ALL_TAGS.get(tag)), new Map())), new Map()), // TODO: convert to mapMaybe
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
		console.log(last_started)
		this.setState({ image_show: true, last_started });
	}

	onMainImageLoadHandler = () => this.setState({ image_loaded: true })

	get_post_scores = () => this.state.posts.map(post => [post.url, post.guesses.map(tag => [tag, post.tags.get(tag, null)]) ])

	handleGuessSubmit = e => {
		this.setState(({ posts, guess, last_started }) => ({
			posts: posts.set(last_started, Object.assign(posts.get(last_started), { guesses: posts.get(last_started).guesses.push(guess) })),
			guess: '',
		}));
		e.stopPropagation();
		e.preventDefault();
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
					{ /* console.log(this.get_post_scores().last()[1].toArray()) || */ this.get_post_scores().map(([post_url, guesses], post_i) =>
						<p index={post_i}>
							{ post_i >= this.state.last_started ? null : <img src={post_url} width="50" /> }
							<ul index={post_i}>
								{guesses.map(([tag, score]) => <li><span>{tag}</span><span>{score}</span></li>).toArray()}
							</ul>
						</p>
					).toArray() }
				</section>
			</div>
		}
	}
}
