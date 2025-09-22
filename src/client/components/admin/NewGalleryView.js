import React from 'react';
import {Link,withRouter} from 'react-router-dom';

import uiState from '../../UiState';

class NewGalleryView extends React.Component {
  constructor() {
    super();
    
    this.state = {
      name: '',
      description: '',
      date: ''
    }
  }
  
  onChangeName(event) {
    this.setState({ name: event.target.value });
  }
  
  onChangeDescription(event) {
    this.setState({ description: event.target.value });
  }

  onChangeDate(event) {
    this.setState({ date: event.target.value });
  }
  
  onSave(event) {
    // Without this my DB crashed everytime i pressed save with empty fields
    if(this.state.name == '' || this.state.date == '') 
      return;

    event.preventDefault();
    
    const {name,description,date} = this.state;
    uiState.galleryStore.addGallery(name, description, date)
      .then(() => {
        this.props.history.push('/admin');
      });
  }
  
  render() {
    return (
      <form onSubmit={ this.onSave.bind(this) }>
        <h4> Nytt Galleri </h4>
        <p> Tänk på att inte ha för långt namn på ditt galleri! </p>
        
        <label>Namn på galleri:</label>
        <input className="u-full-width" type="text" value={ this.state.name } onChange={ this.onChangeName.bind(this) } placeholder="namn" />
        <label>Beskrivning utav gallery:</label>
        <textarea className="u-full-width" value={ this.state.description } onChange={ this.onChangeDescription.bind(this) }/>
        <label>Datum för galleri:</label>
        <input className="u-full-width" type="date" value={ this.state.date } onChange={ this.onChangeDate.bind(this) } placeholder="yyyy-mm-dd" />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <button type="submit" className="button-primary">Spara</button>
            <Link to="/admin/gallery">
              <button type="button" className="button">← Tillbaka</button>
            </Link>
        </div>
      </form>
    );
  }
}

export default withRouter(NewGalleryView);
