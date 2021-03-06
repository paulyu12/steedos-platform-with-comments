const InternalData = require('../core/internalData');
var _ = require("underscore");
const odataMongodb = require("odata-v4-mongodb");
const clone = require('clone');
var objectCore = require('./objects.core.js');
const objectql = require('@steedos/objectql');
const auth = require('@steedos/auth');
const MAX_MASTER_DETAIL_LEAVE = objectql.MAX_MASTER_DETAIL_LEAVE;
const validateOptionValue = (value)=>{
    let color = value && value.split(":")[2];
    if(color){
        const reg = /^(#)?[\da-f]{3}([\da-f]{3})?$/i;
        if(!reg.test(color)){
            throw new Error("object_fields_error_option_color_not_valid");
        }
    }
}

const validateOptionsValue = (value)=>{
    if(value){
        value.split("\n").forEach(function(option) {
            let options;
            if (option.indexOf(",")) {
                options = option.split(",");
                return options.forEach(function(_option) {
                    validateOptionValue(_option);
                });
            } else {
                validateOptionValue(option);
            }
        });
    }
}

const validateOptionColorValue = (value)=>{
    if(value){
        const reg = /^[\da-f]{6}$/i;
        if(!reg.test(value)){
            throw new Error("object_fields_error_option_color_not_valid");
        }
    }
}

const validateOptionsGridValue = (value)=>{
    if(value){
        value.forEach(function(option) {
            if(!option.label){
                throw new Error("object_fields_error_option_label_required");
            }
            if(!option.value){
                throw new Error("object_fields_error_option_value_required");
            }
            validateOptionColorValue(option.color);
        });
    }
}

const validateDoc = (doc)=>{
    validateOptionsGridValue(doc.options);
    // if(doc.type === "autonumber"){
    //     let formula = doc.formula && doc.formula.trim();
    //     if(!formula){
    //         throw new Error("object_fields_error_formula_required");
    //     }
    // }
}



async function checkOwnerField(doc) {
    if (doc.name !== "owner") {
        return;
    }
    if (!doc.omit) {
        const obj = objectql.getObject(doc.object);
        const masters = await obj.getMasters();
        if (masters && masters.length) {
            throw new Meteor.Error(doc.name, "???????????????????????????????????????????????????????????????????????????????????????????????????????????????");
        }
    }
}

function checkMasterDetailPathsRepeat(doc, masterPaths, detailPaths) {
    // ?????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
    _.each(masterPaths, (masterPathItems) => {
        _.each(detailPaths, (detailPathItems) => {
            const repeatName = objectql.getRepeatObjectNameFromPaths([masterPathItems.concat(detailPathItems)]);
            if (repeatName) {
                throw new Meteor.Error(doc.name, "???????????????????????????????????????????????????????????????????????????????????????" + repeatName);
            }
        });
    });
}

async function checkMasterDetailTypeField(doc, oldReferenceTo) {
    if (!doc || !doc.type || doc.type !== "master_detail") {
        return;
    }
    if (doc.reference_to === doc.object) {
        throw new Meteor.Error(doc.name, "????????????????????????????????????[??????/??????]???????????????");
    }
    const obj = objectql.getObject(doc.object);
    if (!obj) {
        throw new Meteor.Error(doc.name, `????????????????????????`);
    }

    const refObj = objectql.getObject(doc.reference_to);
    if (!refObj) {
        throw new Meteor.Error(doc.name, `????????????????????????`);
    }

    let currentMasters = await obj.getMasters();
    let currentDetails = await obj.getDetails();
    if (oldReferenceTo) {
        let index = currentMasters.indexOf(oldReferenceTo);
        if (index >= 0) {
            currentMasters.splice(index, 1);
        }
    }

    if (currentMasters.indexOf(doc.reference_to) > -1) {
        throw new Meteor.Error(doc.name, `????????????????????????????????????????????????????????????????????????????????????????????????????????????`);
    }

    const mastersCount = currentMasters.length;
    const detailsCount = currentDetails.length;
    if (mastersCount > 1) {
        throw new Meteor.Error(doc.name, "????????????????????????????????????????????????????????????????????????????????????");
    }
    else if (mastersCount > 0) {
        if (detailsCount > 0) {
            throw new Meteor.Error(doc.name, "?????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????");
        }
    }

    const detailPaths = await obj.getDetailPaths();
    const masterPaths = await refObj.getMasterPaths();
    // ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????
    checkMasterDetailPathsRepeat(doc, masterPaths, detailPaths);

    // ???????????????????????????????????????????????????????????????????????????MAX_MASTER_DETAIL_LEAVE????????????
    const maxDetailLeave = await obj.getMaxDetailsLeave(detailPaths);
    // console.log("===maxDetailLeave===", maxDetailLeave);
    if (maxDetailLeave > MAX_MASTER_DETAIL_LEAVE - 1) {
        throw new Meteor.Error(doc.name, "????????????????????????????????????????????????????????????????????????????????????");
    }

    // ?????????????????????????????????????????????????????????????????????????????????????????????MAX_DETAIL_LEAVE????????????
    const maxMasterLeave = await refObj.getMaxMastersLeave(masterPaths);
    // console.log("===maxMasterLeave===", maxMasterLeave);
    if (maxMasterLeave + maxDetailLeave > MAX_MASTER_DETAIL_LEAVE - 1) {
        throw new Meteor.Error(doc.name, "????????????????????????????????????????????????????????????????????????????????????");
    }
    // let fields = await obj.getFields();
    // const ownerField = _.find(fields, (n) => { return n.name === "owner"; });
    // if (!ownerField.omit) {
    //     throw new Meteor.Error(doc.name, "?????????????????????????????????????????????????????????????????????????????????????????????????????????????????????");
    // }
}

function getFieldName(object, fieldName, spaceId, oldFieldName){
    if(object && object.datasource && object.datasource != 'default'){
      return fieldName;
    }else{
      if(fieldName != 'name' && fieldName != 'owner'){
        return objectql._makeNewFieldName(fieldName, spaceId, oldFieldName);
      }else{
        return fieldName
      }
    }
  }

const checkFormulaInfiniteLoop = async function(_doc, oldFieldName){
    if(_doc.type === "formula"){
      doc = clone(_doc)
      delete doc._id
      const objectConfig = objectql.wrapAsync(async function(){
        return await objectql.getObject(doc.object).toConfig();
      })
    //   objectCore.loadDBObject(objectConfig)
      delete objectConfig._id;
      try {
        if(!doc.name){
            doc.name = getFieldName(objectConfig, doc._name, doc.space, oldFieldName)
        }
        await objectql.verifyObjectFieldFormulaConfig(doc, objectConfig);
      } catch (error) {
        if(error.message.startsWith('Infinite Loop')){
          throw new Error('?????????????????????????????????????????????????????????');
        }else{
          throw error;
        }
      }
    }
  }

const initSummaryDoc = async (doc) => {
    if (!doc.summary_object) {
        throw new Error("object_fields_error_summary_object_required");
    }
    let summaryObject = objectql.getObjectConfig(doc.summary_object);
    let summaryConfig = {
        summary_object: doc.summary_object,
        summary_type: doc.summary_type,
        summary_field: doc.summary_field,
        field_name: doc.name,
        object_name: doc.object
    };
    const dataType = await objectql.getSummaryDataType(summaryConfig, summaryObject);
    if (!dataType) {
        throw new Error("object_fields_error_summary_data_type_not_found");
    }
    doc.data_type = dataType;
    objectql.validateFilters(doc.summary_filters, summaryObject.fields);
}

module.exports = {
    afterFind: async function(){
        let filters = InternalData.parserFilters(this.query.filters);
        let objectName = filters.object;
        if(objectName){
            let fields = await InternalData.getObjectFields(objectName, this.userId);
            if(fields){
                this.data.values = this.data.values.concat(fields)

                this.data.values = objectql.getSteedosSchema().metadataDriver.find(this.data.values, this.query, this.spaceId);
            }
        }
    },
    beforeFind: async function(){
        const { query } = this;
        if(query.fields && _.isArray(query.fields) && !_.include(query.fields, 'object')){
            query.fields.push('object')
        }
        if(query.fields && _.isArray(query.fields) && !_.include(query.fields, 'name')){
            query.fields.push('name')
        }
    },
    beforeAggregate: async function(){
        const { query } = this;
        if(query.fields && _.isArray(query.fields) && !_.include(query.fields, 'object')){
            query.fields.push('object')
        }
    },
    afterAggregate: async function(){
        let filters = InternalData.parserFilters(this.query.filters);
        let objectName = filters.object;
        if(objectName){
            let fields = await InternalData.getObjectFields(objectName, this.userId);
            if(fields){
                this.data.values = this.data.values.concat(fields)

                this.data.values = objectql.getSteedosSchema().metadataDriver.find(this.data.values, this.query, this.spaceId);
            }
        }
    },
    afterCount: async function(){
        let result = await objectql.getObject('object_fields').find(this.query, await auth.getSessionByUserId(this.userId, this.spaceId))
        this.data.values = result.length;
    },
    afterFindOne: async function(){
        if(_.isEmpty(this.data.values)){
            let id = this.id
            let objectName = id.substr(0, id.indexOf("."));
            if(objectName){
                let field = await InternalData.getObjectField(objectName, this.userId, id);
                if(field){
                    this.data.values = field;
                }
            }
        }
    },
    beforeInsert: async function () {
        let doc = this.doc;
        validateDoc(doc);
        await checkFormulaInfiniteLoop(doc);
        await checkMasterDetailTypeField(doc);
        await checkOwnerField(doc);
        
        if(doc.type === "summary"){
            await initSummaryDoc(doc);
        }
        if(doc.type === "select" && doc.data_type && doc.data_type != 'text'){
            const options = doc.options;
            _.each(options, (item)=>{
                const value = item.value;
                const numberValue = Number(item.value);
                if( doc.data_type === 'number' && !(_.isNumber(numberValue) && !_.isNaN(numberValue)) ){
                    throw new Meteor.Error(500, "????????????????????????????????????????????????????????????, ???????????????????????????");
                }
                if( doc.data_type === 'boolean' && ['true','false'].indexOf(value) < 0){
                    throw new Meteor.Error(500, "????????????????????????????????????????????????????????????, ????????? true ??? false???");
                }
            })
        }
    },
    beforeUpdate: async function () {
        let { doc, object_name, id} = this;
        validateDoc(doc);
        // const dbDoc = await objectql.getObject(object_name).findOne(id)
        const dbDoc = objectql.wrapAsync(async function(){
          return await objectql.getObject(object_name).findOne(id)
        })
        let oldReferenceTo = dbDoc.type === "master_detail" && dbDoc.reference_to;
        await checkFormulaInfiniteLoop(doc, dbDoc.name);
        await checkMasterDetailTypeField(doc, oldReferenceTo);
        await checkOwnerField(doc);
        
        if(doc.type === "summary"){
            await initSummaryDoc(doc);
        }
        if(["parent","children"].indexOf(dbDoc._name) > -1){
            let isImportField = false;
            if(doc._name !== dbDoc._name || doc.type !== dbDoc.type || doc.object !== dbDoc.object || doc.reference_to !== dbDoc.reference_to || !!doc.multiple !== !!dbDoc.multiple || ("children" === dbDoc._name && doc.omit !== true)){
                isImportField = true;
            }
            if(isImportField){
                throw new Meteor.Error(500, "??????parent???children??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????/???????????????????????????");
            }
        }

        if(doc.type === "select" && doc.data_type && doc.data_type != 'text'){
            const options = doc.options;
            _.each(options, (item)=>{
                const value = item.value;
                const numberValue = Number(item.value);
                if( doc.data_type === 'number' && !(_.isNumber(numberValue) && !_.isNaN(numberValue)) ){
                    throw new Meteor.Error(500, "????????????????????????????????????????????????????????????, ???????????????????????????");
                }
                console.log('doc==>',doc.data_type , value)
                if( doc.data_type === 'boolean' && ['true','false'].indexOf(value) < 0){
                    throw new Meteor.Error(500, "????????????????????????????????????????????????????????????, ????????? true ??? false???");
                }
            })
        }
    },
    beforeDelete: async function () {
        const field = await this.getObject(this.object_name).findOne(this.id,{fields:['name','object']});
        const enable_tree = await objectql.getObject(field.object).enable_tree;
        if( ["parent","children"].indexOf(field.name) > -1 && enable_tree ){
            throw new Meteor.Error(500, "???????????????????????????????????????????????????parent???children?????????");
        }
    }
}