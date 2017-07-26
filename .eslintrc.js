module.exports = {
  "extends": ["google"],
	"parserOptions": {
		"ecmaVersion": 8,
		"sourceType": "module"
	},
	"rules": {
		"arrow-parens": ["error", "as-needed"],
		"max-len": "off",
		"new-cap": ["error", {"capIsNewExceptions": ["NewJob"]}],
		"require-jsdoc": "off",
		"semi": "off",
		"quotes": ["error", "double"],
	}
};
