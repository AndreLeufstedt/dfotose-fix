import _ from 'lodash';
import {Router} from 'express';
import bodyParser from 'body-parser';
import krb5 from 'kerberos';
import {inHTMLData} from 'xss-filters';

import User from '../model/user';
import {Restrictions, getRestrictionsForRole} from '../model/user-roles';

import {updateAuthorOfImagesUploadedByCid} from './image-api';
import {fetchInitialRole, removeElevatedIfExists} from './user-role-api';

import Logger from '../logger';
import {abortOnError} from '../utils';
const Kerberos = new krb5.Kerberos();

const router = Router();
export default router;

const jsonParser = bodyParser.json();

// Get the currently logged in User
//  - Returns 403 if not logged-in
router.get('/auth/user', LoggedInRequired, (req, res) => {
  const user = req.session.user;
  res.send(user);
});

// Get all -saved- users
//  - Returns 403 if not logged-in
router.get('/auth/users',
  requireRestrictions(Restrictions.READ_USERS),
  (req, res) => {
  User.find({}, (err, users) => {
    abortOnError(err, res);

    Logger.info(`User ${req.session.user.cid} fetched all other users`);

    res.send(users);
  });
});

// Login a User
//  - Logs out the previous User if any
router.post('/auth/login', jsonParser, (req, res) => {
  const {cid, password} = req.body;

  /*
  // Development bypass - add your CID here
    if (cid === 'dev' && password === 'dev') {
      User.find({ cid: cid }, (err, results) => {
        abortOnError(err, res);
        if (_.isEmpty(results)) {
          const user = {
            cid: cid,
            fullname: 'Dev User',
            role: 'Admin'
          };
          User(user).save((err) => {
            abortOnError(err, res);
            req.session.user = user;
            Logger.info(`${cid} logged in via dev bypass`);
            res.send(user);
          });
        } else {
          const user = _.head(results);
          req.session.user = user;
          Logger.info(`${cid} logged in via dev bypass`);
          res.send(user);
        }
      });
      return; // Skip Kerberos check
    }
 */

  Kerberos.authUserKrb5Password(cid, password, '', (err, ok) => {
    abortOnError(err, res);

    if (ok) {
      User.find({ cid: cid }, (err, results) => {
        abortOnError(err, res);

        // first time login ?
        if (_.isEmpty(results)) {
          // In case somebody marked this user to receive
          // elevated permissions upon first login
          fetchInitialRole(cid, role => {
            const user = {
              cid: cid,
              fullname: '',
              role: role
            };

            User(user).save((err) => {
              abortOnError(err, res);

              req.session.user = user;
              Logger.info(`${cid} logged in first time, initialized with role ${role}`);

              removeElevatedIfExists(cid);

              res.send(user);
            });
          });
        } else {
          const user = _.head(results);
          req.session.user = user;

          Logger.info(`User ${user.cid} logged in. Has role ${user.role}`);

          // Migrate this user once logged in to the new role-based-system.
          const dfotoMember = _.get(user, 'dfotoMember', false);
          if (dfotoMember && user.role == 'None') {
            user.role = 'Admin';
            _.set(req.session, 'user.role', 'Admin');

            User.findOneAndUpdate({ cid: user.cid }, { $set: { role: 'Admin' }}, err => {
              abortOnError(err, res);
              Logger.info(`Migrated ${user.cid} to new role-based system.`);
            });
          }

          res.send(user);
        }
      });
    } else {
      res.status(401).end();
    }
  });
});

/* Change User-data

  NOTE: this supports setting the restrictions of other users
        as well as the current user; but only if Restrictions.WRITE_USERS
        is met.
 */
router.put('/auth/user/:cid', LoggedInRequired, jsonParser, (req, res) => {
  const cid = req.params.cid;
  const {fullname} = req.body;
  const filteredFullname = inHTMLData(fullname);

  const canWriteUsers = hasRestrictions(req, Restrictions.WRITE_USERS);
  if (cid != req.session.user.cid && !canWriteUsers) {
    res.status(403).end();
    Logger.warn(`User ${req.session.user.cid} had insufficient permissions to write another users data`);
    return;
  }

  const updated = {
    fullname: filteredFullname
  };

  if (_.has(req.body, 'role')) {
    if (!canWriteUsers) {
      res.status(403).end();
      Logger.warn(`User ${req.session.user.cid} had insufficient permissions to change another users role`);
      return;
    }

    updated.role = _.get(req.body, 'role', 'None');
  }

  User.findOneAndUpdate({ cid: cid }, { $set: updated }, (err) => {
    if (err) {
      res.status(500).send(err);
      throw err;
    }

    // Update current User object
    if (req.session.user.cid === cid) {
      _.merge(req.session.user, updated);
    }

    updateAuthorOfImagesUploadedByCid(cid, filteredFullname);

    res.status(202).end();
  });
});

// Logout the currently logged-in User
//  - Returns 403 if not logged-in
router.get('/auth/logout', LoggedInRequired, (req, res) => {
  req.session.destroy();
  res.status(200);
  res.end();
});

function isLoggedIn(req) {
  const hasSession = _.has(req, 'session');
  const hasSessionUser = _.has(req, 'session.user');
  return hasSession && hasSessionUser
}

// Middleware for express to ensure
//  that a valid User is logged-in before continuing.
export function LoggedInRequired(req, res, next) {
  if (isLoggedIn(req)) {
    next();
  } else {
    res.status(403).end();
  }
}

export function hasRestrictions(req, restrictions) {
  if (!isLoggedIn(req)) {
    return false;
  }

  const roleName = _.get(req, 'session.user.role', 'None');
  const roleRestrictions = getRestrictionsForRole(roleName);
  return ((roleRestrictions & restrictions) != 0);
}

// Middleware for express to ensure
//  that a certain set of restrictions is met before serving
//  the request.
export function requireRestrictions(restrictions) {
  return (req, res, next) => {
    if (hasRestrictions(req, restrictions)) {
      next();
    } else {
      res.status(403).end();
    }
  };
}
