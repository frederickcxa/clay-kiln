// note: creation is purely client-side, now that we're generating unique IDs on both the client and server
import _ from 'lodash';
import cuid from 'cuid';
import store from '../core-data/store';
import { UPDATE_COMPONENT, ADD_DEFAULT_DATA, ADD_SCHEMA } from './mutationTypes';
import { getDefaultData, getSchema, getModel, getData } from '../core-data/components';
import { save as modelSave, render as modelRender } from './model';
import { isDefaultComponent, getComponentName, refProp, componentRoute, schemaRoute, instancesRoute } from '../utils/references';
import { getObject, getSchema as getSchemaFromAPI, getText } from '../core-data/api';
import { convertSchema, hasAnyBehaviors } from '../core-data/behaviors2input';
import { props } from '../utils/promises';

/**
 * get default data for a component, from the store or an api call
 * @param  {string} name
 * @param  {object} store
 * @return {Promise}
 */
function resolveDefaultData(name) {
  const prefix = _.get(store, 'state.site.prefix'),
    defaultURI = `${prefix}${componentRoute}${name}`,
    data = getDefaultData(name);

  if (data) {
    return Promise.resolve(data);
  } else {
    // get default data from the server
    return getObject(defaultURI).then((res) => {
      store.commit(ADD_DEFAULT_DATA, { name, data: res });
      return res;
    });
  }
}

/**
 * append styles to the head of the page
 * @param  {string} styles
 */
function appendToHead(styles) {
  const head = document.getElementsByTagName('head')[0],
    el = document.createElement('style');

  el.appendChild(document.createTextNode(styles));
  head.appendChild(el);
}

/**
 * fetch styles for new components
 * @param  {string} name of component
 * @return {Promise}
 */
function fetchComponentStyles(name) {
  const prefix = _.get(store, 'state.site.prefix'),
    slug = _.get(store, 'state.site.slug'),
    baseStylePath = `${prefix}/css/${name}.css`,
    siteStylePath = `${prefix}/css/${name}.${slug}.css`;

  return props({
    base: getText(baseStylePath).catch(_.noop),
    site: getText(siteStylePath).catch(_.noop)
  }).then(({ base, site }) => {
    if (base) {
      appendToHead(base);
    }

    if (site) {
      appendToHead(site);
    }
  });
}

/**
 * get schema for a component, from the store or an api call
 * @param  {string} name
 * @param {object} store
 * @return {Promise}
 */
function resolveSchema(name) {
  const prefix = _.get(store, 'state.site.prefix'),
    schemaURI = `${prefix}${componentRoute}${name}${schemaRoute}`,
    schema = getSchema(name);

  if (schema) {
    return Promise.resolve(schema);
  } else {
    // get schema from the server
    // note: also fetch styles for new components,
    // because if we don't have a schema, we can assume we don't have the styles inlined
    // (we don't care about returning the styles here, but we want to fetch them in parallel)
    return props({
      styles: fetchComponentStyles(name),
      res: getSchemaFromAPI(schemaURI)
    }).then(({ res }) => {
      const newSchema = hasAnyBehaviors(res) ? convertSchema(res, name) : res;

      store.commit(ADD_SCHEMA, { name, data: newSchema });
      return newSchema;
    });
  }
}

/**
 * update the store with created component data
 * note: this does NOT sent a PUT to the server, as that's already handled by
 * the parent component's cascading PUT.
 * the cascading PUT also handles legacy server.js logic,
 * while model logic is handled right here
 * @param  {string} uri
 * @param  {object} data
 * @returns {Promise}
 */
function updateStore(uri, data) {
  if (getModel(uri)) {
    return modelSave(uri, data, {})
      .then((savedData) => modelRender(uri, savedData))
      .then((renderableData) => {
        store.commit(UPDATE_COMPONENT, {uri, data: renderableData});

        return renderableData;
      });
  } else {
    store.commit(UPDATE_COMPONENT, {uri, data});
    return Promise.resolve();
  }
}

/**
 * synchronously determine if a component has references to default components
 * inside component lists. these child components will be cloned
 * when creating the parent component
 * note: if you passed in `clone: true`, ALL child references will be cloned (not just default refs)
 * @param {object} data
 * @param {boolean} [clone]
 * @returns {object}
 */
function getChildComponents(data, clone) {
  let mapping = {};

  _.forOwn(data, function checkProperties(val, key) {
    // loop through the (base) data in the component
    if (_.isArray(val)) {
      // find arrays
      _.each(val, function checkArrays(item, index) {
        // see if these arrays contain components
        if (item[refProp] && (isDefaultComponent(item[refProp]) || clone)) {
          // if they do, and if the component references are base (not instance) refs,
          // add them to the mapping object
          // note: we'll use the mapping object to update the parent component
          // after new instances are created
          mapping[`${key}[${index}]`] = item[refProp];
        }
      });
    } else if (_.isObject(val)) {
      if (val[refProp] && (isDefaultComponent(val[refProp]) || clone)) {
        mapping[key] = val[refProp];
      }
    }
  });

  return mapping;
}

/**
 * create child components and add them to the parent data
 * @param {object} children mapping from getChildComponents
 * @param {string} uri
 * @param {object} data
 * @param {boolean} [clone]
 * @returns {Promise}
 */
function addChildrenToParent(children, uri, data, clone) {
  const prefix = _.get(store, 'state.site.prefix');

  let promises = {};

  _.forOwn(children, (childURI, parentPath) => {
    const childName = getComponentName(childURI);

    let dataPromise;

    if (clone) {
      // clone the already-existing data, rather than fetching the default data
      dataPromise = Promise.resolve(_.toPlainObject(getData(childURI)));
    } else {
      dataPromise = resolveDefaultData(childName);
    }

    promises[parentPath] = dataPromise.then((defaultData) => {
      const childInstanceURI = `${prefix}${componentRoute}${childName}${instancesRoute}/${cuid()}`,
        grandChildren = getChildComponents(defaultData, clone);

      if (_.size(grandChildren)) {
        return addChildrenToParent(grandChildren, childInstanceURI, defaultData, clone).then((refData) => {
          return resolveSchema(childName)
            .then(() => updateStore(childInstanceURI, refData))
            .then(() => _.assign({}, refData, { [refProp]: childInstanceURI }));
        });
      } else {
        // kick this off so we'll have it after saving
        return resolveSchema(childName).then(() => {
          // add component to the store before adding ref prop
          return updateStore(childInstanceURI, defaultData).then(() => _.assign({}, defaultData, { [refProp]: childInstanceURI }));
        });
      }
    });
  });

  // once we have grabbed all the default data and generated uris, add them to the parent component
  return props(promises).then((childrenData) => {
    const storeData = _.cloneDeep(data),
      fullData = _.cloneDeep(data);

    // first, update the store with just the child refs
    _.forOwn(childrenData, (val, key) => {
      _.set(storeData, key, { [refProp]: val[refProp] });
    });

    return updateStore(uri, storeData).then(() => {
      // then actually add the child data into the parent, so we can do a cascading put
      _.forOwn(childrenData, (val, key) => {
        _.set(fullData, key, val);
      });

      return _.assign({}, fullData, { [refProp]: uri });
    });
  });
}

/**
 * create a component and its children
 * @param  {string} component.name
 * @param  {object} [component.data] optional default data
 * @param {boolean} [clone]
 * @return {Promise}
 */
function createComponentAndChildren({name, data}, clone) {
  const prefix = _.get(store, 'state.site.prefix');

  data = data || {};

  return props({
    schema: resolveSchema(name), // kick this off so we'll have it after saving
    defaultData: resolveDefaultData(name)
  }).then(({defaultData}) => {
    // if we passed in data, merge it with the default data to create the instance
    const newInstanceData = _.assign({}, defaultData, data),
      newInstanceURI = `${prefix}${componentRoute}${name}${instancesRoute}/${cuid()}`,
      children = getChildComponents(newInstanceData, clone);

    if (_.size(children)) {
      // component has child components! create them too
      return addChildrenToParent(children, newInstanceURI, newInstanceData, clone);
    } else {
      // add component to the store before adding ref prop
      return updateStore(newInstanceURI, newInstanceData).then((savedData) => _.assign({}, newInstanceData, { [refProp]: newInstanceURI }, savedData));
    }
  });
}

/**
 * create components:
 * - generate instance IDs
 * - resolve and cache default data
 * - resolve and cache schemas
 * - create child components if a default ref exists in the default parent data
 * @param  {array} components with { name, [data] }
 * @param {boolean} [clone] to clone ALL child component references, not just default instances
 * @returns {Promise} with array of created child components
 */
export default function create(components, clone) {
  return Promise.all(_.map(components, (component) => createComponentAndChildren(component, clone)));
}
