const _ = require("underscore");
const util = require('../util');
const objectql = require("@steedos/objectql");
const InternalData = require('../core/internalData');

const getInternalWorkflowRules = function(sourceWorkflowRules, filters){
    let dbWorkflowRules = Creator.getCollection("workflow_rule").find(filters, {fields:{_id:1, name:1}}).fetch();
    let workflowRules = [];

    if(!filters.is_system){
        _.forEach(sourceWorkflowRules, function(doc){
            if(!_.find(dbWorkflowRules, function(p){
                return p.name === doc.name
            })){
                workflowRules.push(doc);
            }
        })
    }
    return workflowRules;
}

module.exports = {
    beforeInsert: async function () {
        await util.checkAPIName(this.object_name, 'name', this.doc.name);

    },
    beforeUpdate: async function () {
        if (_.has(this.doc, 'name')) {
            await util.checkAPIName(this.object_name, 'name', this.doc.name, this.id);
        }
    },
    afterFind: async function(){
        let filters = InternalData.parserFilters(this.query.filters)
        let workflowRules = [];
        if(filters.object_name){
            workflowRules = objectql.getObjectWorkflowRules(filters.object_name);
            delete filters.object_name;
        }else{
            workflowRules = objectql.getAllWorkflowRules();
        }

        workflowRules = getInternalWorkflowRules(workflowRules, filters);

        if(workflowRules && workflowRules.length>0){
            this.data.values = this.data.values.concat(workflowRules)
        }
    },
    afterAggregate: async function(){
        let filters = InternalData.parserFilters(this.query.filters)
        let workflowRules = [];
        if(filters.object_name){
            workflowRules = objectql.getObjectWorkflowRules(filters.object_name);
            delete filters.object_name;
        }else{
            workflowRules = objectql.getAllWorkflowRules();
        }
        
        workflowRules = getInternalWorkflowRules(workflowRules, filters);

        if(workflowRules && workflowRules.length>0){
            this.data.values = this.data.values.concat(workflowRules)
        }
    },
    afterCount: async function(){
        let filters = InternalData.parserFilters(this.query.filters)
        let workflowRules = [];
        if(filters.object_name){
            workflowRules = objectql.getObjectWorkflowRules(filters.object_name);
            delete filters.object_name;
        }else{
            workflowRules = objectql.getAllWorkflowRules();
        }
        
        workflowRules = getInternalWorkflowRules(workflowRules, filters);

        if(workflowRules && workflowRules.length>0){
            this.data.values = this.data.values + workflowRules.length
        }
    },
    afterFindOne: async function(){
        if(_.isEmpty(this.data.values)){
            let id = this.id
            let objectName = id.substr(0, id.indexOf("."));
            if(objectName){
                let workflowRule = objectql.getObjectWorkflowRule(objectName, id.substr(id.indexOf(".")+1));
                if(workflowRule){
                    this.data.values = workflowRule;
                }
            }
        }
    },
}