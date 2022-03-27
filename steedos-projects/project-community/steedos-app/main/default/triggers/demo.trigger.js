const objectql = require('@steedos/objectql');

module.exports = {
    listenTo: 'triggerobject__c',

    beforeInsert: async function(){
        var doc = this.doc
        throw new Error(doc.counter);
    },

    beforeUpdate: async function(){
    
    },

    beforeDelete: async function(){
    
    },

    afterInsert: async function(){
    
    },

    afterUpdate: async function(){
    
    },

    afterDelete: async function(){
    
    },

}