import _ from 'lodash';
import uuid from 'uuid';
import {Router} from 'express';
import multer from 'multer';
import fs from 'fs-extra';
import path from 'path';
import sharp from 'sharp';
import bodyParser from 'body-parser';
import {inHTMLData} from 'xss-filters';
import mongoose from 'mongoose';
import exifParser from 'exif-parser';
import moment from 'moment';

import {Restrictions} from '../model/user-roles';
import {requireRestrictions, hasRestrictions} from './auth-api.js';
import Logger from '../logger';
import config from '../config';
import {abortOnError} from '../utils';

const jsonParser = bodyParser.json();


import Image from '../model/image';
import ImageTag from '../model/image-tag';
import Gallery from '../model/gallery';

const imageQueue = require('../image-processor');
const { v4: uuidv4 } = require('uuid');
const router = Router();
export default router;

const imageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const path = config.storage.temporaryImagePath;
    cb(null, path);
  },
  filename: function (req, file, cb) {
    const filename = `${file.originalname}`;
    cb(null, filename);
  }
});

const upload = multer({ storage: imageStorage });

// Make sure storage directories are created
fs.mkdirs(config.storage.temporaryImagePath, (err) => {
  if (err) {
    Logger.error(`Could not create storage directory ${config.storage.temporaryImagePath}`);
    throw err;
  }
});
fs.mkdirs(config.storage.path, (err) => {
  if (err) {
    Logger.error(`Could not create storage directory ${config.storage.path}`);
    throw err;
  }
});

// Return all images for a specific gallery
router.get('/image/:galleryId', (req, res) => {
  const galleryId = req.params.galleryId;

  Image.find({galleryId: galleryId}).sort('shotAt').exec((err, images) => {
    if (err) {
      res.status(500).send(err);
      throw err;
    }

    res.send(images);
  });
});

router.get('/image/:id/details', (req,res) => {
  const id = req.params.id;
  Image.findById(id, (err, image) => {
    abortOnError(err, res);
    res.send(image);
  });
});

// Return a specific image using an id
router.get('/image/:id/fullSize', (req, res) => {
  const id = req.params.id;

  Image.findById(id, (err, image) => {
    if (err) {
      res.status(500).send(err);
      throw err;
    }

    res.sendFile(image.fullSize);
  });
});

router.get('/image/:id/thumbnail', (req, res) => {
  const id = req.params.id;

  Image.findById(id, (err, image) => {
    if (err) {
      res.status(500).send(err);
      throw err;
    }

    res.sendFile(image.thumbnail);
  });
});

router.get('/image/:id/preview', (req, res) => {
  const id = req.params.id;

  Image.findById(id, (err, image) => {
    if (err) {
      res.status(500).send(err);
      throw err;
    }

    res.sendFile(image.preview);
  });
});

router.get('/image/:id/tags', (req, res) => {
  const id = req.params.id;
  ImageTag.find({ imageId: id }, (err, imageTags) => {
    abortOnError(err, res);

    res.send(imageTags);
  });
});

router.get('/image/:id/author', (req, res) => {
    const id = req.params.id;
    Image.findById(id, (err, image) => {
        abortOnError(err, res);
        res.send(image.author);
    });
})


router.post('/image/:id/author-name', jsonParser, (req, res) => {
    const imageId = req.params.id;
    const {authorName} = req.body;
    const filteredAuthorName = inHTMLData(authorName);

    const canWriteImage = hasRestrictions(
        req,
        Restrictions.WRITE_GALLERY | Restrictions.WRITE_IMAGES
    );

    if (!canWriteImage) {
      res.status(403).end();
      Logger.warn(`User ${req.session.user.cid} had insufficient permissions to change author name`);
      return;
    }

    // Directly update the image with the custom author name
    Image.findOneAndUpdate({_id: imageId}, {
      $set: {
        author: filteredAuthorName
      }
    }, (err) => {
      abortOnError(err, res);

      console.log(`Changed author to ${filteredAuthorName} for image ${imageId}`);
      res.status(202).end();
    });
});

router.post('/image/:id/gallerythumbnail', (req,res) => {
  const id = req.params.id;

  const canWriteImage = hasRestrictions(
      req,
      Restrictions.WRITE_GALLERY | Restrictions.WRITE_IMAGES
  );

  if (!canWriteImage) {
    res.status(403).end();
    Logger.warn(`User ${req.session.user.cid} had insufficient permissions to change thumbnail.`);
    return;
  }

  // Find the image that should be set as thumbnail
  Image.findOne({_id: id}, (err, newThumb) => {
    abortOnError(err, res);

    // Remove the image that was previously thumbnail
    Image.find({galleryId: newThumb.galleryId, isGalleryThumbnail: true}, (err, oldThumbs) => {
      if (oldThumbs !== null && oldThumbs.length !== 0) {
        oldThumbs.forEach(oldThumb => {
          oldThumb.isGalleryThumbnail = false;
          oldThumb.save();
        });
      }
      else { console.log("No old thumbnail found"); }
    });

    // Set the new one as thumbnail
    newThumb.isGalleryThumbnail = true;
    newThumb.save();
    console.log(`Changed gallery thumbnail to ${id} for gallery ${newThumb.galleryId}`);
    res.status(202).end();

  });
})

function handleImages(req, res, galleryId) {
  const userCid = req.session.user.cid;
  const userFullname = _.get(req.session, 'user.fullname', '');
  const images = req.files;
  
  let processed = 0;
  const jobs = [];
  
  _.forEach(images, function(image) {
    const fieldName = _.get(image, 'fieldname');
    if (fieldName !== 'photos') {
      return;
    }
    
    const extension = image.originalname.split('.').pop().toLowerCase();
    const filename = uuidv4();
    const galleryPath = path.resolve(config.storage.path, galleryId);
    const fullSizeImagePath = galleryPath + '/' + filename + '.' + extension;
    
    // Create directories
    createDirectoryIfNeeded(galleryPath);
    createDirectoryIfNeeded(path.resolve(galleryPath, "thumbnails"));
    createDirectoryIfNeeded(path.resolve(galleryPath, "previews"));
    
    // Move file then queue it
    fs.move(image.path, fullSizeImagePath, function(err) {
      if (err) {
        Logger.error('Error moving file:', err);
        processed++;
        return;
      }
      
      // Add to queue
      imageQueue.add({
        fullSizeImagePath: fullSizeImagePath,
        galleryPath: galleryPath,
        filename: filename,
        extension: extension,
        userCid: userCid,
        galleryId: galleryId,
        userFullname: userFullname
      }, {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        }
      }).then(function(job) {
        jobs.push(job.id);
        processed++;
        
        // When all are queued, respond
        if (processed === images.length) {
          Logger.info(images.length + ' images queued by ' + userCid);
        }
      }).catch(function(err) {
        Logger.error('Queue error:', err);
        processed++;
      });
    });
  });
}


const uploadWithFields = multer({ storage: imageStorage }).fields([
  { name: 'photos', maxCount: 100 },
  { name: 'photographerName', maxCount: 1 }
]);


router.post('/image/:id/tags', jsonParser, (req, res) => {
  const imageId = req.params.id;

  const {tagName} = req.body;
  const filteredTagName = inHTMLData(tagName).toLowerCase();

  const imageTagData = {
    imageId: imageId,
    tagName: filteredTagName
  };

  var newTag = new ImageTag(imageTagData);
  newTag.save((err) => {
    abortOnError(err, res);

    // Now add a duplicate to the images list of tags
    Image.findById(imageId, (err, image) => {
      abortOnError(err, res);

      image.tags.push(filteredTagName);
      const newImageTags = image.tags;

      Image.findOneAndUpdate({ _id: imageId }, {
        $set: {
          tags: newImageTags
        }
      }, (err) => {
        abortOnError(err, res);

        console.log(`Added tag ${filteredTagName} to image ${imageId}`);
        res.status(202).end();
      });
    });
  });
});

router.get('/image/tags/:tagName/search', (req, res) => {
  const tagName = req.params.tagName.toLowerCase();

  ImageTag.find({ tagName: tagName }, (err, imageTags) => {
    abortOnError(err, res);

    // imageTags contains all of the ids of images we need to send
    // to the client
    const imageObjectIds = _.map(imageTags, tag => {
      return mongoose.Types.ObjectId(tag.imageId);
    });

    Image.find({ '_id': {
      $in: imageObjectIds
    }}, (err, images) => {
      abortOnError(err, res);

      res.send(images);
    });
  });
});

function createDirectoryIfNeeded(dir) {
  try {
    fs.statSync(dir);
  } catch(err) {
    fs.mkdirSync(dir);
  }
}

function readExifData(imagePath, cb) {
  fs.open(imagePath, 'r', (status, fd) => {
    if (status) {
      Logger.error(`Could not open ${imagePath} for reading`);
      return;
    }

    var buffer = new Buffer(65635); // 64kb buffer
    fs.read(fd, buffer, 0, 65635, 0, (err, bytesRead) => {
      if (err) {
        Logger.error(`Could not read EXIF data from ${imagePath}`);
        return;
      }

      try {
        var parser = exifParser.create(buffer);
        const parsed = parser.parse();
        cb(parsed);
      } catch(ex) {
        cb({});
      }
    });
  });
}

// Keep the upload routes exactly as they were:
router.post('/image',
  requireRestrictions(Restrictions.WRITE_IMAGES | Restrictions.WRITE_GALLERY),
  upload.array('photos'), (req, res) => {
  handleImages(req, res, 'undefined');
  res.status(202).send();
});

router.post('/image/:galleryId',
  requireRestrictions(Restrictions.WRITE_IMAGES),
  upload.array('photos'), (req, res) => {
  const galleryId = req.params.galleryId;

  Gallery.findById(galleryId, (err) => {
    if (err) {
      res.status(500).send(err);
      throw err;
    }

    Logger.info(`Preparing upload of files to gallery ${galleryId}`);
    handleImages(req, res, galleryId);
    res.status(202).send();
  });
});

// Updates the author retroactively on all images
// uploaded by a certain user
export function updateAuthorOfImagesUploadedByCid(cid, author) {
  const updated = { author: author };

  Image.find({ authorCid: cid }, (err, images) => {
    _.forEach(images, image => {
      Image.findOneAndUpdate(
        { _id: image._id },
        { $set : updated },
        (err, image) => {
          if (err) {
            throw err;
          }
        }
      );
    });
  });
}

// Get the queue status for album
router.get('/image/queue-status/:galleryId', function(req, res) {
  const galleryId = req.params.galleryId;
  
  Promise.all([
    imageQueue.getWaiting(),
    imageQueue.getActive(),
    imageQueue.getCompleted(),
    imageQueue.getFailed()
  ]).then(function(results) {
    const allJobs = results[0].concat(results[1], results[2], results[3]);
    
    const galleryJobs = allJobs.filter(function(job) {
      return job.data && job.data.galleryId === galleryId;
    }).map(function(job) {
      return {
        id: job.id,
        filename: job.data.filename,
        progress: job.progress(),
        state: job.finishedOn ? 'completed' : 
               job.processedOn ? 'active' : 
               job.failedReason ? 'failed' : 'waiting'
      };
    });
    
    res.json(galleryJobs);
  }).catch(function(err) {
    res.status(500).json({ error: 'Could not get status' });
  });
});

// Delete a specific image
//  - Note: this automatically removes all gallery
//          associations.
router.delete('/image/:id',
  requireRestrictions(Restrictions.WRITE_IMAGES | Restrictions.WRITE_GALLERY),
  (req, res) => {
  const id = req.params.id;

  Image.findByIdAndRemove(id, (err, image) => {
    if (err) {
      res.status(500).send(err);
      throw err;
    }

    Logger.info(`User ${req.session.user.cid} removed image ${id}`);

    res.status(202).send();
  });
});

// Photo Statistics
router.get('/stats/photos', (req, res) => {
  Image.countDocuments({}, (err, count) => {
    if (err) {
      Logger.error('Error counting images:', err);
      return res.status(500).json({ error: 'Could not count images' });
    }
    res.json({ count });
  });
});