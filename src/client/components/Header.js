import React from "react";
import {Link} from "react-router-dom";
import {observer} from 'mobx-react';
import axios from 'axios';
import uiState from '../UiState';

@observer
class Header extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      photoCount: null,
      loading: true
    };
  }

  componentDidMount() {
    this.fetchPhotoCount();
  }

  fetchPhotoCount() {
    axios.get('/v1/stats/photos')
      .then(response => {
        this.setState({ 
          photoCount: response.data.count,
          loading: false 
        });
      })
      .catch(error => {
        console.error('Error fetching photo count:', error);
        this.setState({ loading: false });
      });
  }

  formatNumber(num) {
    if (!num) return '0';
    return num.toLocaleString('sv-SE');
  }

  render() {
    const { photoCount, loading } = this.state;
    
    return (
      <div className="header">
        <div className="header-content">
          <Link to="/"><img src="/assets/images/logo.png"/></Link>
          
          {/* Photo count in the middle */}
          <div className={`header-photo-count ${loading ? 'loading' : ''}`}>
            {loading ? (
              <span>Bilder: ...</span>
            ) : (
              <span>Bilder: <strong>{this.formatNumber(photoCount)}</strong></span>
            )}
          </div>
          
          <ul>
            <li>
              <Link to="/"> Bilder </Link>
            </li>
            <li>
              <Link to="/image/search/"> Sök </Link>
            </li>
            <li>
              <Link to="/about"> Om oss </Link>
            </li>
            { uiState.user.isLoggedIn && uiState.user.role != 'None' ?
              <li>
                <Link to="/admin">Admin </Link>
              </li>
              : null }
          </ul>
        </div>
        <div className="sticky-header" />
      </div>
    );
  }
}

export default Header;
