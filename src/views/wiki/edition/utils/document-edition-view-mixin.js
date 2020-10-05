import AssociationsInputRow from './AssociationsInputRow';
import EditionContainer from './EditionContainer';
import FormField from './FormField';
import FormInput from './FormInput';
import FormRow from './FormRow';
import FormSection from './FormSection';
import MapInputRow from './MapInputRow';
import QualityField from './QualityField';

import c2c from '@/js/apis/c2c';
import constants from '@/js/constants';
import ol from '@/js/libs/ol';

const geoJSONFormat = new ol.format.GeoJSON();
const FORM_PROJ = 'EPSG:4326';
const DATA_PROJ = 'EPSG:3857';

export default {
  components: {
    FormRow,

    FormSection,
    FormField,
    QualityField,
    FormInput,
    MapInputRow,
    EditionContainer,
    AssociationsInputRow,
  },

  data() {
    return {
      promise: {},
      fields: null, // keep fields here to set them reactive
      genericErrors: [],
      saving: false,
      modified: false,
    };
  },

  computed: {
    mode() {
      return this.$route.name.split('-')[1]; // right part of route name : add or edit
    },

    documentType() {
      return this.$route.name.replace(/-(edit|add)/, '');
    },

    documentId() {
      return this.$route.params.id;
    },

    lang() {
      return this.$route.params.lang;
    },

    document() {
      return this.promise.data;
    },

    editedLocale() {
      // in edit mode, there is only one locale
      return this.document ? this.document.locales[0] : null;
    },
  },

  watch: {
    $route: {
      handler: 'load',
      immediate: true,
    },
    'document.geometry.geom': 'setLatitudeLongitude',
  },

  mounted() {
    window.addEventListener('beforeunload', this.beforeUnload);
  },

  beforeDestroy() {
    window.removeEventListener('beforeunload', this.beforeUnload);
  },

  beforeRouteEnter(to, from, next) {
    next((vm) => {
      if (!vm.$user.isLogged) {
        vm.$router.push({ name: 'auth' });
      }
    });
  },

  beforeRouteLeave(to, from, next) {
    if (this.modified) {
      const answer = window.confirm(this.$gettext('Do you really want to leave? you have unsaved changes!'));
      if (answer) {
        next();
      } else {
        next(false);
      }
    } else {
      next();
    }
  },

  methods: {
    load() {
      this.fields = constants.objectDefinitions[this.documentType].fields;
      this.cleanErrors();
      this.latitude = null;
      this.longitude = null;

      // as this method will be called in any case,
      // we must check that the user is logged
      // redirection is made be beforeRouteEnter()
      // but we do not wan't to do anythin in this case
      if (!this.$user.isLogged) {
        return;
      }

      if (this.mode === 'edit') {
        this.promise = c2c[this.documentType].get(this.documentId, this.lang).then((response) => {
          const locales = response.data.locales;

          if (locales.length === 0) {
            // it's a translation from an existing doc
            locales.push(this.$documentUtils.buildLocale(this.documentType, this.lang));
          }

          this.afterLoad(response);

          // TODO : implements a algorithm to determin if document has bee modified
          this.modified = true;
        });
      } else {
        this.promise = { data: this.$documentUtils.buildDocument(this.documentType, this.lang) };

        // add current user for outings
        if (this.documentType === 'outing') {
          c2c.profile.get(this.$user.id).then((response) => {
            this.$documentUtils.addAssociation(this.document, response.data);
          });
        }

        // Add associations presents in url query
        for (const letter of Object.keys(this.$route.query)) {
          const documentType = this.$documentUtils.getDocumentType(letter);

          if (documentType && this.$route.query[letter]) {
            // Value may be a number or a string
            const documentIds = String(this.$route.query[letter]).split(',');

            for (const documentId of documentIds) {
              c2c[documentType].get(documentId).then((response) => {
                this.$documentUtils.addAssociation(this.document, response.data);
              });
            }
          }
        }

        if (this.$route.query.act) {
          this.document.activities = this.$route.query.act.split(',');
        }

        this.afterLoad();

        // TODO : implements a algorithm to determine if document has been modified
        this.modified = true;
      }
    },

    setGeometryPoint() {
      if (this.latitude === null || this.longitude === null) {
        return;
      }

      const longitude = parseFloat(String(this.longitude).replace(',', '.'));
      const latitude = parseFloat(String(this.latitude).replace(',', '.'));

      const point = new ol.geom.Point([longitude, latitude]);
      point.transform(FORM_PROJ, DATA_PROJ);
      this.document.geometry.geom = geoJSONFormat.writeGeometry(point);
    },

    setLatitudeLongitude() {
      if (!this.document || !this.document.geometry || !this.document.geometry.geom) {
        return {};
      }

      const point = geoJSONFormat.readGeometry(this.document.geometry.geom);

      point.transform(DATA_PROJ, FORM_PROJ);

      const coords = point.getCoordinates();

      this.longitude = Math.round(coords[0] * 1000000) / 1000000;
      this.latitude = Math.round(coords[1] * 1000000) / 1000000;
    },

    afterLoad() {},

    beforeSave() {},

    // display a popup with info from fields taht contains an error
    // return true if popup is displayed, false otherwise
    displayErrors(isApiMassage) {
      const fieldsWithError = this.getFieldsWithError();
      const i18nContext = isApiMassage ? 'API message' : undefined;

      // list of possible API message (keep js syntax, for messages extraction)
      // $gettext('Shorter than minimum length 1', 'API message');
      // $gettext('at least one route required', 'API message');
      // $gettext('at least one user required', 'API message');
      // $gettext('This field must be a valid ISBN.', 'API message');

      if (fieldsWithError.length !== 0) {
        const messages = fieldsWithError.map((field) => {
          return `${this.$gettext(field.name)} : ${this.$gettext(field.error.description, i18nContext)}`;
        });

        this.$alert.show(messages);

        return true;
      }

      return false;
    },

    save(comment) {
      if (this.lang === 'eu' && !this.$user.isModerator) {
        this.$alert.show([
          this.$gettext(
            "Sorry, euskara lang has been frozen.\nWe're looking for a moderator, if you're interested, please contact board@camptocamp.org"
          ),
        ]);
        return;
      }

      this.beforeSave(); // allow each view to handle some specific cases

      this.computeErrors();

      if (this.displayErrors(false)) {
        return;
      }

      let promise;

      this.saving = true;

      if (this.mode === 'edit') {
        promise = c2c[this.documentType].save(this.document, comment).then(() => {
          this.modified = false;
          this.goToDocument(this.document.document_id);
        });
      } else {
        promise = c2c[this.documentType].create(this.document).then((response) => {
          this.modified = false;
          this.goToDocument(response.data.document_id);
        });
      }

      promise.catch((error) => {
        this.saving = false;
        const data = error.response.data;
        this.dispatchErrors(data.errors);
      });
    },

    // after saving, go to document
    // when it's a creation, id is in request's response.
    goToDocument(documentId) {
      this.$router.push({
        name: this.documentType,
        params: {
          id: documentId,
          lang: this.lang,
        },
      });
    },

    computeErrors() {
      for (const field of Object.values(this.fields)) {
        field.error = field.getError(this.document, this.editedLocale);
      }
    },

    getFieldsWithError() {
      return Object.values(this.fields).filter((field) => field.error !== null);
    },

    dispatchErrors(errors) {
      // TODO : errors === undefined ?
      this.cleanErrors();

      for (const error of errors) {
        const path = error.name.split('.');

        if (path[0] === 'locales') {
          this.dispatchError(path[2], error);
        } else if (path[0] === 'associations') {
          this.dispatchError(path[1], error);
        } else {
          this.dispatchError(path[0], error);
        }
      }

      this.displayErrors(true);
    },

    dispatchError(fieldName, error) {
      if (this.fields[fieldName] === undefined) {
        this.genericErrors.push(error);
      } else {
        this.fields[fieldName].error = error;
      }
    },

    cleanErrors() {
      this.genericErrors = [];
      for (const field of Object.values(this.fields)) {
        field.error = null;
      }
    },

    beforeUnload(event) {
      if (this.modified) {
        event.preventDefault();
        event.returnValue = '';
      }
    },
  },
};
