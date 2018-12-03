import * as React from "react";
import { connect } from "react-redux";
import * as Utils from "./utils";
import * as Selectors from "./redux/selectors";
import * as Actions from "./redux/actionCreators";
import Disposable from "./Disposable";

class Header extends React.Component {
  constructor(props) {
    super(props);
    this._disposable = new Disposable();
    this._inputRef = null;
  }

  componentDidMount() {
    const handler = e => {
      // slash
      if (e.keyCode === 191) {
        if (this._inputRef == null) {
          return;
        }
        if (this._inputRef !== document.activeElement) {
          this._inputRef.focus();
          e.preventDefault();
        }
      }
    };
    window.document.addEventListener("keydown", handler);
    this._disposable.add(() => {
      window.document.removeEventListener("keydown", handler);
    });
  }

  componentWillUnmount() {
    this._disposable.dispose();
  }
  render() {
    return (
      <div id="search">
        <h1>
          <a
            href="/"
            onClick={e => {
              if (Utils.eventIsLinkClick(e)) {
                e.preventDefault();
                this.props.setSearchQuery(null);
              }
            }}
          >
            <span id="logo">{"🌩️"}</span>
            <span className="name">Winamp Skin Museum</span>
          </a>
        </h1>
        <span style={{ flexGrow: 1 }} />
        <input
          type="text"
          className="zoom-on-hover"
          onChange={e => this.props.setSearchQuery(e.target.value)}
          value={this.props.searchQuery || ""}
          placeholder={"Search..."}
          ref={node => {
            this._inputRef = node;
          }}
        />
        <button
          className="zoom-on-hover"
          onClick={() => {
            this.props.requestRandomSkin();
          }}
        >
          Random
        </button>
      </div>
    );
  }
}

const mapStateToProps = state => ({
  searchQuery: Selectors.getSearchQuery(state)
});

const mapDispatchToProps = dispatch => ({
  setSearchQuery(query) {
    dispatch(Actions.searchQueryChanged(query));
  },
  requestRandomSkin() {
    dispatch(Actions.requestedRandomSkin());
  }
});
export default connect(
  mapStateToProps,
  mapDispatchToProps
)(Header);
